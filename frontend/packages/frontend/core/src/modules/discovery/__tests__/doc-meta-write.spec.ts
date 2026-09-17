import type { DocMeta } from '@blocksuite/affine/store';
import { describe, expect, test } from 'vitest';

import { diffTags, planMetaWrite } from '../plan-meta-write';

/**
 * #151 段階3: ローカルの変更をサーバーへ送る。
 *
 * ⚠️ ここで守っているのは、**間違えると利用者の変更が消える**性質のもの。
 *
 * - タグは**差分**で送る（配列全体を送ると #164 と同じ形で一方が消える）
 * - 版数は**サーバーが返した最新**を使う（古いと自分の直前の変更に負ける）
 * - 変わっていないものは**送らない**（送ると全員のキャッシュが失効する）
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.2 / 7.5.10 / 7.7
 */
describe('#151 段階3 メタデータの送信', () => {
  const DOC = 'doc-1';

  const meta = (over: Partial<DocMeta> = {}): DocMeta => ({
    id: DOC,
    title: '元の題',
    tags: ['x'],
    createDate: 0,
    trash: false,
    ...over,
  });

  /** 手元が把握している版数（既定は未移行の 0） */
  const revs = (over: Partial<Record<'title' | 'trash' | 'tags', string>> = {}) => ({
    title: over.title ?? '0',
    trash: over.trash ?? '0',
    tags: over.tags ?? '0',
  });

  const plan = (props: Partial<DocMeta>, before = meta(), r = revs()) =>
    planMetaWrite({ props, before, revisions: r });

  describe('タグは差分で送る', () => {
    /**
     * ⚠️ **配列全体を送らないこと。**
     * 送ると2人が別のタグを付けたときに一方が消える（#164 と同じ形）。
     */
    test('⚠️ 足したタグだけを add に載せる', () => {
      expect(diffTags(['x'], ['x', 'z'])).toEqual({ add: ['z'], remove: [] });
    });

    test('⚠️ 外したタグだけを remove に載せる', () => {
      expect(diffTags(['x', 'z'], ['x'])).toEqual({ add: [], remove: ['z'] });
    });

    test('足しと外しが同時でも、それぞれに分かれる', () => {
      expect(diffTags(['x'], ['z'])).toEqual({ add: ['z'], remove: ['x'] });
    });

    test('変わっていなければ、どちらも空', () => {
      expect(diffTags(['x'], ['x'])).toEqual({ add: [], remove: [] });
    });

    test('送る内容も差分になっている', () => {
      const plans = plan({ tags: ['x', 'z'] });
      expect(plans).toEqual([{ field: 'tags', add: ['z'], remove: [] }]);
    });
  });

  describe('無駄に送らない', () => {
    /**
     * ⚠️ 送ると版数が上がり、**全員のキャッシュが失効する**。
     */
    test('⚠️ タグが変わっていなければ送らない', () => {
      expect(plan({ tags: ['x'] })).toEqual([]);
    });

    test('題が変わっていなければ送らない', () => {
      expect(plan({ title: '元の題' })).toEqual([]);
    });

    test('ゴミ箱の状態が変わっていなければ送らない', () => {
      expect(plan({ trash: false })).toEqual([]);
    });

    test('変更に含まれないフィールドは送らない', () => {
      expect(plan({ title: '新しい題' }).map(p => p.field)).toEqual(['title']);
    });
  });

  describe('移行期間の扱い', () => {
    /**
     * ⚠️ 移行期間は「見ていた値」も添えていたが、**撤去した**（7.7.5）。
     * `doc-meta-sync` が無くなり、版数を上げずに値が変わることが無くなった。
     * 判定は版数だけで足りる。
     */
    test('⚠️ 見ていた値は添えない（版数だけで判定する）', () => {
      const [p] = plan({ title: '新しい題' });
      expect(p).not.toHaveProperty('observedTitle');
    });

    test('版数を知らないうちは 0 を送る（＝まだ移行していない）', () => {
      const [p] = plan({ title: '新しい題' });
      expect(p).toMatchObject({ baseRevision: '0' });
    });
  });

  describe('版数はフィールドごとに使い分ける', () => {
    test('題には titleRevision を使う', () => {
      const [p] = plan({ title: '新しい題' }, meta(), revs({ title: '3' }));
      expect(p).toMatchObject({ baseRevision: '3' });
    });

    test('ゴミ箱には trashRevision を使う', () => {
      const [p] = plan({ trash: true }, meta(), revs({ trash: '4' }));
      expect(p).toMatchObject({ baseRevision: '4' });
    });

    /**
     * ⚠️ タグは**操作型**なので版数を送らない（7.5.10）。
     * 順序に依存しないため、競合制御に版数が要らない。
     */
    test('⚠️ タグには版数を載せない', () => {
      const [p] = plan({ tags: ['x', 'z'] }, meta(), revs({ tags: '9' }));
      expect(p).not.toHaveProperty('baseRevision');
    });
  });
});
