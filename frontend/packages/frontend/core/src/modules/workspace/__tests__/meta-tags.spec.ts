import { beforeEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';

import { WorkspaceMetaImpl } from '../impls/meta';

/**
 * #164: **タグの同時編集で一方の変更が失われないこと。**
 *
 * > ⚠️ `doc.tags = [...]` は Y.Array ごと差し替わるため、Y.Map のキー競合となり
 * > last-writer-wins で片方が丸ごと捨てられる。**要素単位で更新すること。**
 *
 * ここが崩れると「タグを付けたのに消える」「外したのに復活する」が起きる。
 * 症状が地味で、利用者からは同期の不調に見える。
 *
 * この操作モデルは #151 段階3（A案）の未送信変更キューでも使う
 * （`docs/discovery-stage3-comparison.md` 7.5.8）。
 */
describe('#164 タグの同時編集', () => {
  /** 正本を1つ作る。ページ A に初期タグを持たせる */
  const makeOrigin = (tags: string[]) => {
    const doc = new Y.Doc();
    const meta = new WorkspaceMetaImpl(doc);
    meta.initialize();
    meta.addDocMeta({ id: 'A', title: 'ページA', tags, createDate: 0 });
    return { doc, meta };
  };

  /** 正本から分岐したクライアントを作る */
  const fork = (origin: Y.Doc) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(origin));
    return { doc, meta: new WorkspaceMetaImpl(doc) };
  };

  /** 全員を相互に同期させる（2巡させて収束を確実にする） */
  const sync = (...docs: Y.Doc[]) => {
    for (let round = 0; round < 2; round++) {
      for (const a of docs) {
        for (const b of docs) {
          if (a === b) continue;
          Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
        }
      }
    }
  };

  const tagsOf = (meta: WorkspaceMetaImpl): string[] => [
    ...(meta.getDocMeta('A')?.tags ?? []),
  ];

  let origin: ReturnType<typeof makeOrigin>;

  beforeEach(() => {
    origin = makeOrigin(['x']);
  });

  test('① 2人が同時に別のタグを足すと、両方残る', () => {
    const c1 = fork(origin.doc);
    const c2 = fork(origin.doc);

    c1.meta.setDocMeta('A', { tags: ['x', 'z'] });
    c2.meta.setDocMeta('A', { tags: ['x', 'w'] });
    sync(origin.doc, c1.doc, c2.doc);

    const tags = tagsOf(origin.meta);
    expect(tags).toContain('z');
    expect(tags).toContain('w');
    expect(tags).toContain('x');
  });

  test('② 一方が外し、他方が足すと、外したタグは復活しない', () => {
    const c1 = fork(origin.doc);
    const c2 = fork(origin.doc);

    c1.meta.setDocMeta('A', { tags: ['x', 'z'] }); // z を足す
    c2.meta.setDocMeta('A', { tags: [] }); // x を外す
    sync(origin.doc, c1.doc, c2.doc);

    const tags = tagsOf(origin.meta);
    expect(tags).not.toContain('x');
    expect(tags).toContain('z');
  });

  test('③ オフライン復帰時の突き合わせでも変更が消えない', () => {
    const offline = fork(origin.doc);
    const other = fork(origin.doc);

    // オフライン中に自分がタグを足す
    offline.meta.setDocMeta('A', { tags: ['x', 'z'] });
    // その間に他人も足す
    other.meta.setDocMeta('A', { tags: ['x', 'w'] });
    sync(origin.doc, other.doc); // 先に他人の分だけ届く
    sync(origin.doc, offline.doc, other.doc); // 復帰

    const tags = tagsOf(origin.meta);
    expect(tags).toContain('z');
    expect(tags).toContain('w');
  });

  test('④ タグを外すと消える（単独操作の回帰）', () => {
    origin.meta.setDocMeta('A', { tags: [] });
    expect(tagsOf(origin.meta)).toEqual([]);
  });

  test('⑤ 同一タグの同時追加で重複しても、次のタグ操作で解消される', () => {
    const c1 = fork(origin.doc);
    const c2 = fork(origin.doc);

    c1.meta.setDocMeta('A', { tags: ['x', 'z'] });
    c2.meta.setDocMeta('A', { tags: ['x', 'z'] }); // 同じタグを同時に
    sync(origin.doc, c1.doc, c2.doc);

    // ⚠️ この時点で重複しうる。仕様上の許容事項（タグ自体は失われない）
    expect(tagsOf(origin.meta)).toContain('z');

    // 誰かが次にタグを触ると正規化される
    const c3 = fork(origin.doc);
    c3.meta.setDocMeta('A', { tags: ['x', 'z'] });
    sync(origin.doc, c3.doc);

    expect(tagsOf(origin.meta).filter(t => t === 'z')).toHaveLength(1);
  });

  /**
   * ⚠️ **実装方式を維持するための回帰テスト。**
   *
   * 重複の掃除を「2つ目以降を消す」ではなく「重複を1つ消す」と書くと、
   * 2人が同時に掃除して**タグが両方とも消える**。
   */
  test('⑥ 2人が同時に重複を掃除しても、タグが全部消えない', () => {
    const a = fork(origin.doc);
    const b = fork(origin.doc);
    a.meta.setDocMeta('A', { tags: ['x', 'z'] });
    b.meta.setDocMeta('A', { tags: ['x', 'z'] });
    sync(origin.doc, a.doc, b.doc);

    const c1 = fork(origin.doc);
    const c2 = fork(origin.doc);
    c1.meta.setDocMeta('A', { tags: ['x', 'z'] }); // 同時に掃除
    c2.meta.setDocMeta('A', { tags: ['x', 'z'] });
    sync(origin.doc, c1.doc, c2.doc);

    const tags = tagsOf(origin.meta);
    expect(tags).toContain('x');
    expect(tags.filter(t => t === 'z')).toHaveLength(1);
  });

  /**
   * ⚠️ **回避策の前提を固定するテスト。**
   *
   * `_applyTags` は配列が無い場合だけ代入にフォールバックする。そこは
   * Y.Array を作る行為自体が競合するため要素単位にできず、この不具合が
   * そのまま再現する（実測済み）。
   *
   * **「作成時に必ず tags が入る」ことでその経路に入らないようにしている。**
   * ここが崩れると、修正が効かないドキュメントが生まれる。
   */
  test('⑨ ドキュメント作成時に tags が必ず配列で初期化される', () => {
    const doc = new Y.Doc();
    const meta = new WorkspaceMetaImpl(doc);
    meta.initialize();
    // workspace.ts:141-147 の createDoc と同じ引数
    meta.addDocMeta({ id: 'B', title: '', tags: [], createDate: Date.now() });

    expect(Array.isArray(meta.getDocMeta('B')?.tags)).toBe(true);
  });

  test('⑦ タグ以外のフィールドは今までどおり更新される', () => {
    origin.meta.setDocMeta('A', { title: '改名後', trash: true });
    const meta = origin.meta.getDocMeta('A');
    expect(meta?.title).toBe('改名後');
    expect(meta?.trash).toBe(true);
    expect(meta?.tags).toEqual(['x']);
  });

  test('⑧ 全クライアントが同じ結果へ収束する', () => {
    const c1 = fork(origin.doc);
    const c2 = fork(origin.doc);
    c1.meta.setDocMeta('A', { tags: ['x', 'z'] });
    c2.meta.setDocMeta('A', { tags: ['w'] });
    sync(origin.doc, c1.doc, c2.doc);

    const origin_ = tagsOf(origin.meta);
    expect(tagsOf(c1.meta)).toEqual(origin_);
    expect(tagsOf(c2.meta)).toEqual(origin_);
  });
});
