import { describe, expect, test } from 'vitest';

import ja from '../ja.json';

/**
 * #172: property（プロパティ）を不動産の意味に取った誤訳「6 その他の物件」。
 * 複数形だけが誤訳で、2件以上のときに出るため目に付く。単数形も同じ形にそろえる。
 */
describe('ja: プロパティの件数表示（#172）', () => {
  const MORE = 'com.affine.page-properties.more-property.more';
  const ONE = 'com.affine.page-properties.more-property.one';
  const EXPECTED = '他 {{ count }} 件のプロパティ';

  test('⚠️ 「物件」と訳さない', () => {
    expect(ja[MORE]).not.toContain('物件');
    expect(ja[ONE]).not.toContain('物件');
  });

  test('複数形と単数形が同じ形', () => {
    expect(ja[MORE]).toBe(EXPECTED);
    expect(ja[ONE]).toBe(EXPECTED);
  });
});
