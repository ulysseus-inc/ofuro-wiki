import type { Framework } from '@toeverything/infra';

import { VirtualKeyboardProvider } from '../providers/virtual-keyboard';

/**
 * #105: ブラウザだけで動く仮想キーボードの窓口。
 *
 * ⚠️ **この実装が無いと、スマホ版は画面を描く前に落ちる。**
 * 上流 AFFiNE では iOS / Android のアプリ（Capacitor）が実装を入れていたが、
 * ofuro-wiki は Web だけで配るため、誰も入れていなかった。
 *
 * キーボードの高さは `visualViewport`（表示領域）の縮みから求める。
 * ブラウザから開閉はできないため、`show` / `hide` は持たない
 * （`VirtualKeyboardProvider` は「変化を知らせるだけ」の形も許している）。
 */
export function configureBrowserVirtualKeyboardProvider(framework: Framework) {
  framework.impl(VirtualKeyboardProvider, {
    onChange: (callback: (info: { visible: boolean; height: number }) => void) => {
      const viewport = globalThis.visualViewport;
      if (!viewport) {
        // 対応していないブラウザでは「常に閉じている」として扱う（落とさない）
        callback({ visible: false, height: 0 });
        return () => {};
      }

      const notify = () => {
        // 表示領域が縮んだ分がキーボードの高さ。小さな誤差は無視する
        const height = Math.max(
          0,
          window.innerHeight - viewport.height - viewport.offsetTop
        );
        callback({ visible: height > 1, height });
      };

      notify();
      viewport.addEventListener('resize', notify);
      viewport.addEventListener('scroll', notify);
      return () => {
        viewport.removeEventListener('resize', notify);
        viewport.removeEventListener('scroll', notify);
      };
    },
  });
}
