import { describe, expect, it } from 'vitest';

import { acceptAttrFor } from '../../utils/file/filesys.js';

describe('acceptAttrFor', () => {
  it('MIME だけでなく拡張子も含める', () => {
    // MIME だけだと、.md に MIME を登録していない OS（Windows が典型）で
    // ファイル選択ダイアログに .md が一件も表示されない
    expect(acceptAttrFor('Markdown')).toBe('text/markdown,.md,.markdown');
  });

  it('Any は空（すべてのファイルを選べる）', () => {
    expect(acceptAttrFor('Any')).toBe('');
  });

  it('インポートで使う形式がすべて拡張子を持つ', () => {
    // docs/import.md の対応形式。ここが空だと該当ファイルを選べなくなる
    for (const type of ['Markdown', 'Html', 'Zip', 'Docx'] as const) {
      const accept = acceptAttrFor(type);
      expect(
        accept.split(',').filter(v => v.startsWith('.')),
        `${type} に拡張子が含まれていない: ${accept}`
      ).not.toHaveLength(0);
    }
  });

  it('未知の形式は例外', () => {
    // @ts-expect-error 型では弾かれるが、実行時にも落ちること
    expect(() => acceptAttrFor('Unknown')).toThrow();
  });
});
