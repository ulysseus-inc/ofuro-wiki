import { BlockComponent } from '@blocksuite/std';
import type { PropertyValues } from 'lit';

/**
 * lit `repeat` の DOM 同期破綻からエディタを自己回復させる Mixin。
 *
 * カラムセルのように深くネストした構造では、ペースト/IME/選択などのネイティブな
 * DOM 改変が lit-html の境界コメントノードを切り離し、次の再描画で
 * `_$clear` が `null.nextSibling` を読んでクラッシュすることがある
 * （詳細: docs/columns-block.md）。
 *
 * モデル（データ）自体は整合しているため、描画状態を捨てて作り直せば回復する
 * （ページをリロードしたときと同じ）。この Mixin は `update()` で例外を捕捉し、
 * lit が保持する描画パートと DOM を破棄してフル再描画をやり直す。
 */
export const RecoverableRenderMixin = <
  T extends abstract new (...args: any[]) => BlockComponent,
>(
  superClass: T
) => {
  abstract class RecoverableRenderClass extends superClass {
    /** 直近で自己回復した時刻（タイトループ防止用） */
    private _lastRecoverAt = 0;

    override update(changedProperties: PropertyValues) {
      try {
        super.update(changedProperties);
      } catch (err) {
        this._recoverFromRenderError(err);
      }
    }

    private _recoverFromRenderError(err: unknown) {
      const now = Date.now();
      // 短時間に連続で失敗する場合（外部から DOM を改変され続ける等）は
      // 無限ループを避けるため再回復を見送る。次のユーザー操作で再試行される。
      if (now - this._lastRecoverAt < 1000) {
        console.error(
          '[columns] 描画エラーから回復できませんでした（連続発生のため抑止）',
          err
        );
        return;
      }
      this._lastRecoverAt = now;
      console.warn('[columns] 描画エラーを検知。描画を作り直して回復します', err);

      try {
        // lit は常に this.renderRoot に対して描画する（ShadowlessElement では
        // renderRoot === this だが、Light/Shadow どちらでも確実に扱うため renderRoot を対象にする）。
        const renderRoot = this.renderRoot as HTMLElement | ShadowRoot;
        // lit-html がルートパートを保持する安定プロパティ（公式に unminified 維持）。
        // これを消すと次回 render 時に新しいマーカーでパートが作り直される。
        delete (renderRoot as unknown as Record<string, unknown>)['_$litPart$'];
        // 破綻した DOM を一掃する。
        renderRoot.replaceChildren();
        // 次サイクルでフル再描画。
        this.requestUpdate();
      } catch (recoverErr) {
        console.error('[columns] 描画の作り直しに失敗しました', recoverErr);
      }
    }
  }

  return RecoverableRenderClass;
};
