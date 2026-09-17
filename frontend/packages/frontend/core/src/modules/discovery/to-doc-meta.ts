import type { DocMeta } from '@blocksuite/affine/store';

import type { DiscoveryCacheDocument } from './stores/discovery-cache';

/**
 * #151 段階3: **台帳の1件を、画面が読む形へ写す。**
 *
 * ⚠️ 段階3 では、これが Discovery Metadata の**唯一の供給元**になる。
 * 写し漏らした項目は「無い」ことになるため、
 * 一覧から題が消える・ゴミ箱の中身が出てくる、といった形で現れる。
 *
 * ⚠️ **題の `null` は空文字へ寄せる。** `DocMeta.title` は文字列であり、
 * `undefined` にすると読み出し側が「値が無い」と解釈して
 * **本文の題で上書きする**（7.3 の事故と同じ経路）。
 */
export function toDocMeta(doc: DiscoveryCacheDocument): DocMeta {
  return {
    id: doc.id,
    title: doc.title ?? '',
    tags: doc.tagIds,
    trash: doc.trash,
    createDate: Date.parse(doc.createdAt) || 0,
    updatedDate: Date.parse(doc.updatedAt) || undefined,
  } as DocMeta;
}
