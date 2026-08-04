import { Injectable } from '@nestjs/common';

/**
 * #117: 検知条件C（429）・D（未登録アドレスへの試行）のカウンタ。
 *
 * **メモリ上に持つ。監査ログには書かない**（docs/intrusion-detection.md 2.1）。
 * どちらも「レート制限が弾いた」「存在しないアカウントだった」という
 * **防げている事象**であり、証跡として保全する必要がない。
 * 一方、攻撃中は大量に発生するため、監査ログに1件ずつ書くと DB が膨らむ
 * （1つの IP から1時間あたり最大 18,000 回になりうる）。
 *
 * 再起動で消えるが、攻撃が続いていれば数分で再び閾値に達する。
 */

/** 数える対象。 */
export type CounterKind = 'throttled' | 'unknownEmail';

/**
 * 1分単位のバケツに貯める。イベントを1件ずつ保持しない。
 *
 * ⚠️ 攻撃中は毎秒のように呼ばれる。1件ずつ配列に積むと、
 * **攻撃者が送るリクエスト量に比例してメモリが増える**（攻撃者に制御される）。
 * 分単位で丸めれば、上限は「保持する分数 × IP数」で決まる。
 */
const BUCKET_MS = 60 * 1000;

/**
 * 1バケツあたりに覚えておく IP の上限。
 *
 * 発信元を分散させる攻撃で IP が際限なく増えるのを防ぐ。
 * 超えた分は件数だけ `overflow` に足す（合計は正しく、内訳だけ落ちる）。
 * 通知に出すのは上位3件だけなので、内訳の欠落は実害にならない。
 */
const MAX_IPS_PER_BUCKET = 1000;

/** IP 不明のときのキー。集計から落とさず、まとめて数える。 */
const UNKNOWN_IP = 'unknown';

interface Bucket {
  /** IP ごとの件数。 */
  ips: Map<string, number>;
  /** 上限を超えて内訳を落とした分の件数。 */
  overflow: number;
}

export interface CounterSummary {
  /** 窓内の合計件数。 */
  total: number;
  /** 件数の多い順（呼び出し側が件数を絞る）。 */
  ips: { ip: string; count: number }[];
  /** 最後に1件でも計上された時刻。一度も無ければ null。 */
  lastEventAt: Date | null;
}

@Injectable()
export class AttackCounterService {
  /** 種別 → バケツ開始時刻(ms) → 内訳。 */
  private readonly buckets = new Map<CounterKind, Map<number, Bucket>>();

  /**
   * 保持する最大の分数。
   *
   * 集計の窓（既定60分）と、終息判定の静穏時間（既定30分）の
   * **長い方**まで遡れれば足りる。余裕を持って 24 時間分は持たない
   * （メモリを無駄に使うだけで、使い道がない）。
   */
  private retentionMs = 90 * BUCKET_MS;

  /**
   * 保持期間を設定する。検知サービスが起動時に、実際の設定値から決める。
   * 窓や静穏時間を伸ばしたのに保持期間が短いと、**黙って0件になる**。
   */
  setRetention(windowMinutes: number, quietMinutes: number): void {
    this.retentionMs = (Math.max(windowMinutes, quietMinutes) + 5) * BUCKET_MS;
  }

  /** レート制限（429）で弾いた。 */
  recordThrottled(ip?: string | null): void {
    this.add('throttled', ip);
  }

  /** 存在しないアドレスへのサインイン試行。 */
  recordUnknownEmail(ip?: string | null): void {
    this.add('unknownEmail', ip);
  }

  private add(kind: CounterKind, ip?: string | null): void {
    const now = Date.now();
    this.prune(now);

    let byBucket = this.buckets.get(kind);
    if (!byBucket) {
      byBucket = new Map();
      this.buckets.set(kind, byBucket);
    }

    const key = Math.floor(now / BUCKET_MS) * BUCKET_MS;
    let bucket = byBucket.get(key);
    if (!bucket) {
      bucket = { ips: new Map(), overflow: 0 };
      byBucket.set(key, bucket);
    }

    const id = ip?.trim() || UNKNOWN_IP;
    const current = bucket.ips.get(id);
    if (current !== undefined) {
      bucket.ips.set(id, current + 1);
    } else if (bucket.ips.size < MAX_IPS_PER_BUCKET) {
      bucket.ips.set(id, 1);
    } else {
      bucket.overflow += 1;
    }
  }

  /** 直近 `windowMinutes` 分を集計する。 */
  summarize(kind: CounterKind, windowMinutes: number): CounterSummary {
    const now = Date.now();
    this.prune(now);

    const since = now - windowMinutes * BUCKET_MS;
    const byBucket = this.buckets.get(kind);
    if (!byBucket) return { total: 0, ips: [], lastEventAt: null };

    let total = 0;
    let lastBucket = 0;
    const merged = new Map<string, number>();

    for (const [key, bucket] of byBucket) {
      // バケツは開始時刻で持つため、開始が窓より前でも中身は窓内でありうる。
      // 取りこぼすより多めに拾う（1分の粗さは検知の判断に影響しない）。
      if (key + BUCKET_MS <= since) continue;

      for (const [ip, count] of bucket.ips) {
        merged.set(ip, (merged.get(ip) ?? 0) + count);
        total += count;
      }
      total += bucket.overflow;
      if (key > lastBucket) lastBucket = key;
    }

    const ips = [...merged.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total,
      ips,
      // バケツ単位なので分の粒度。静穏判定（既定30分）には十分
      lastEventAt: lastBucket ? new Date(lastBucket) : null,
    };
  }

  /** 保持期間を過ぎたバケツを捨てる。 */
  private prune(now: number): void {
    const limit = now - this.retentionMs;
    for (const byBucket of this.buckets.values()) {
      for (const key of byBucket.keys()) {
        if (key + BUCKET_MS <= limit) byBucket.delete(key);
      }
    }
  }

  /** テスト用。 */
  reset(): void {
    this.buckets.clear();
  }
}
