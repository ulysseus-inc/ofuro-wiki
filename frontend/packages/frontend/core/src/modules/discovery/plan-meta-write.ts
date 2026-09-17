import type { DocMeta } from '@blocksuite/affine/store';

/**
 * #151 段階3: **何をサーバーへ送るかを決める。**
 *
 * ⚠️ **判定だけをここに置く**（副作用なし）。DI の基底クラスから切り離すことで、
 * 仕様の中核を単体で検証できるようにしている（`decide.ts` と同じ方針）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.2 / 7.5.10 / 7.7
 */
export function planMetaWrite(input: {
  props: Partial<DocMeta>;
  /** 変更前のメタ。差分と「見ていた値」を出すために要る */
  before: DocMeta;
  /** 手元が把握している版数 */
  revisions: FieldRevisions;
}): MetaWritePlan[] {
  const { props, before, revisions } = input;
  const plans: MetaWritePlan[] = [];

  // ⚠️ 変わっていないなら送らない。送ると版数が上がり、
  // **全員のキャッシュが失効する**
  if (props.title !== undefined && props.title !== before.title) {
    plans.push({
      field: 'title',
      title: props.title,
      baseRevision: revisions.title,
    });
  }

  if (props.trash !== undefined && props.trash !== before.trash) {
    plans.push({
      field: 'trash',
      trash: props.trash,
      baseRevision: revisions.trash,
    });
  }

  if (props.tags !== undefined) {
    // ⚠️ **配列全体ではなく差分を送る。**
    // 全体を送ると2人が別のタグを付けたときに一方が消える（#164）
    const { add, remove } = diffTags(before.tags ?? [], props.tags);
    if (add.length > 0 || remove.length > 0) {
      plans.push({ field: 'tags', add, remove });
    }
  }

  return plans;
}

/** タグの差分。**足したもの・外したものに分ける。** */
export function diffTags(
  before: string[],
  after: string[]
): { add: string[]; remove: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    add: after.filter(t => !beforeSet.has(t)),
    remove: before.filter(t => !afterSet.has(t)),
  };
}

export type MetaWritePlan =
  | {
      field: 'title';
      title: string;
      baseRevision: string;
    }
  | {
      field: 'trash';
      trash: boolean;
      baseRevision: string;
    }
  | { field: 'tags'; add: string[]; remove: string[] };

export interface FieldRevisions {
  title: string;
  trash: string;
  tags: string;
}

/**
 * 台帳にまだ無い（＝版数を知らない）ときの既定値。
 *
 * ⚠️ **0 は「まだ移行していない」を意味する**（7.7.2）。
 * サーバーはこの場合、版数ではなく「見ていた値」で判定する。
 */
export const MISSING_REVISIONS: FieldRevisions = {
  title: '0',
  trash: '0',
  tags: '0',
};
