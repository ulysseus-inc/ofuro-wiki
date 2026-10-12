import {
  copyMiddleware,
  defaultImageProxyMiddleware,
  titleMiddleware,
} from '@blocksuite/affine-shared/adapters';
import {
  copySelectedModelsCommand,
  draftSelectedModelsCommand,
  getSelectedModelsCommand,
} from '@blocksuite/affine-shared/commands';
import { DisposableGroup } from '@blocksuite/global/disposable';
import { LifeCycleWatcher, type UIEventHandler } from '@blocksuite/std';

/**
 * コピーで切り出す選択の種類。
 * ⚠️ #253 の「切り出すものがあるか」の判定と、実際の切り出しで同じものを使う。
 * ずれると、切り出せる選択なのにブラウザ標準のコピーに落ちる
 */
const COPY_SELECTION_TYPES: Array<'block' | 'text' | 'image'> = [
  'block',
  'text',
  'image',
];

/**
 * ReadOnlyClipboard is a class that provides a read-only clipboard for the root block.
 * It is supported to copy models in the root block.
 */
export class ReadOnlyClipboard extends LifeCycleWatcher {
  static override key = 'affine-readonly-clipboard';

  protected readonly _copySelectedInPage = (onCopy?: () => void) => {
    return this.std.command
      .chain()
      .with({ onCopy })
      .pipe(getSelectedModelsCommand, { types: COPY_SELECTION_TYPES })
      .pipe(draftSelectedModelsCommand)
      .pipe(copySelectedModelsCommand);
  };

  protected _disposables = new DisposableGroup();

  protected _initAdapters = () => {
    const copy = copyMiddleware(this.std);
    this.std.clipboard.use(copy);
    this.std.clipboard.use(
      titleMiddleware(this.std.store.workspace.meta.docMetas)
    );
    this.std.clipboard.use(defaultImageProxyMiddleware);

    this._disposables.add({
      dispose: () => {
        this.std.clipboard.unuse(copy);
        this.std.clipboard.unuse(
          titleMiddleware(this.std.store.workspace.meta.docMetas)
        );
        this.std.clipboard.unuse(defaultImageProxyMiddleware);
      },
    });
  };

  /**
   * #253: エディタが把握している選択に、切り出すブロックがあるか。
   *
   * 画面で文字が選ばれて見えても、エディタ側では選択が外れていることがある
   * （選んだあと Esc を押したときなど）。
   */
  protected readonly _hasSelectedModels = () => {
    const [_, ctx] = this.std.command.exec(getSelectedModelsCommand, {
      types: COPY_SELECTION_TYPES,
    });
    return (ctx.selectedModels?.length ?? 0) > 0;
  };

  onPageCopy: UIEventHandler = ctx => {
    // #253: 切り出すものが無ければ、ブラウザ標準のコピーに任せる。
    // 止めたうえで書き込むと中身ゼロが入り、直前のコピーも消える
    if (!this._hasSelectedModels()) {
      return;
    }

    const e = ctx.get('clipboardState').raw;
    e.preventDefault();

    // In non-secure (HTTP) contexts, navigator.clipboard.write() is
    // unavailable. Use clipboardData.setData() synchronously to write plain
    // text to the OS clipboard so users can paste into external applications.
    // The async pipeline below still runs to store the rich BlockSuite format
    // in the in-memory clipboard for in-editor paste.
    if (!window.isSecureContext && e.clipboardData) {
      const text = window.getSelection()?.toString() ?? '';
      if (text) {
        e.clipboardData.setData('text/plain', text);
      }
    }

    this._copySelectedInPage().run();
  };

  override mounted(): void {
    if (!navigator.clipboard) {
      console.warn(
        'navigator.clipboard is not available (non-HTTPS). Using in-memory clipboard fallback.'
      );
    }
    if (this._disposables.disposed) {
      this._disposables = new DisposableGroup();
    }
    this.std.event.add('copy', this.onPageCopy);
    this._initAdapters();
  }
}
