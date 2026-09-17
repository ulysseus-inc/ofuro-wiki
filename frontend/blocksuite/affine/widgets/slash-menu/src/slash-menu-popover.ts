import { createLitPortal } from '@blocksuite/affine-components/portal';
import {
  cleanSpecifiedTail,
  getInlineEditorByModel,
  getTextContentFromInlineRange,
} from '@blocksuite/affine-rich-text';
import {
  DocModeProvider,
  TelemetryProvider,
} from '@blocksuite/affine-shared/services';
import type { AffineInlineEditor } from '@blocksuite/affine-shared/types';
import {
  createKeydownObserver,
  getCurrentNativeRange,
  getPopperPosition,
  isControlledKeyboardEvent,
  isFuzzyMatch,
  substringMatchScore,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import { WithDisposable } from '@blocksuite/global/lit';
import { ArrowDownSmallIcon } from '@blocksuite/icons/lit';
import { autoPlacement, offset } from '@floating-ui/dom';
import { html, LitElement, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { styleMap } from 'lit/directives/style-map.js';
import { when } from 'lit/directives/when.js';
import groupBy from 'lodash-es/groupBy';
import throttle from 'lodash-es/throttle';

import {
  AFFINE_SLASH_MENU_MAX_HEIGHT,
  AFFINE_SLASH_MENU_TOOLTIP_TIMEOUT,
  AFFINE_SLASH_MENU_TRIGGER_KEY,
} from './consts.js';
import { slashItemToolTipStyle, styles } from './styles.js';
import type {
  SlashMenuActionItem,
  SlashMenuContext,
  SlashMenuItem,
  SlashMenuSubMenu,
} from './types.js';
import {
  isActionItem,
  isSubMenuItem,
  parseGroup,
  slashItemClassName,
} from './utils.js';
const isTextInputKey = (e: KeyboardEvent) => {
  // Keys combined with modifiers are not considered text input
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  // During IME composition, do not treat keydown as text input.
  // Query updates are handled by input/composition hooks.
  if (e.isComposing) return false;

  // Only allow single-character keys as text input
  if (e.key.length !== 1) return false;

  // Keep existing behavior: space closes the slash menu
  if (e.key === ' ') return false;

  return true;
};
type InnerSlashMenuContext = SlashMenuContext & {
  onClickItem: (item: SlashMenuActionItem) => void;
  searching: boolean;
};

export class SlashMenu extends WithDisposable(LitElement) {
  static override styles = styles;

  private get _telemetry() {
    return this.context.std.getOptional(TelemetryProvider);
  }

  private get _editorMode() {
    return this.context.std.get(DocModeProvider).getEditorMode();
  }

  private readonly _handleClickItem = (item: SlashMenuActionItem) => {
    // Need to remove the search string
    // We must to do clean the slash string before we do the action
    // Otherwise, the action may change the model and cause the slash string to be changed
    cleanSpecifiedTail(
      this.context.std,
      this.context.model,
      AFFINE_SLASH_MENU_TRIGGER_KEY + (this._query || '')
    );
    this.inlineEditor
      .waitForUpdate()
      .then(() => {
        item.action(this.context);
        this._telemetry?.track('SelectSlashMenuItem', {
          page: this._editorMode ?? undefined,
          segment:
            this.context.model.flavour === 'affine:edgeless-text'
              ? 'edgeless-text'
              : 'doc',
          module: 'slash menu',
          control: item.name,
        });
        this.abortController.abort();
      })
      .catch(console.error);
  };

  private readonly _initItemPathMap = () => {
    const traverse = (item: SlashMenuItem, path: number[]) => {
      this._itemPathMap.set(item, [...path]);
      if (isSubMenuItem(item)) {
        item.subMenu.forEach((subItem, index) =>
          traverse(subItem, [...path, index])
        );
      }
    };

    this.items.forEach((item, index) => traverse(item, [index]));
  };

  private _innerSlashMenuContext!: InnerSlashMenuContext;

  private readonly _itemPathMap = new Map<SlashMenuItem, number[]>();

  private _queryState: 'off' | 'on' | 'no_result' = 'off';

  private readonly _startRange = this.inlineEditor.getInlineRange();

  /**
   * #197: **文脈が壊れていれば閉じる。壊れていなければ絞り込み直す。**
   *
   * ⚠️ 判断は次のティックで行う。押された瞬間には、その操作が選択や本文を
   * どう変えるかがまだ分からない。
   */
  /** 描画待ちの購読。⚠️ 積み上げると閉じたあとも残る（1つだけ持つ） */
  private _pendingRender: { unsubscribe: () => void } | null = null;
  /** 文脈の確認待ち。⚠️ 閉じたあとに走ると、片付け済みの相手を触る */
  private _pendingContextCheck: ReturnType<typeof setTimeout> | null = null;

  /**
   * ⚠️ **閉じるときに、待たせているものを必ず片付ける。**
   * 購読とタイマーを残すと、片付け済みの相手を触りにいく。
   */
  override disconnectedCallback() {
    super.disconnectedCallback();
    this._pendingRender?.unsubscribe();
    this._pendingRender = null;
    if (this._pendingContextCheck) {
      clearTimeout(this._pendingContextCheck);
      this._pendingContextCheck = null;
    }
  }

  /**
   * 描画が終わってから絞り込み直す。
   *
   * ⚠️ **購読は1つだけ持つ。** 入力のたびに増やすと、発火しないまま
   * 閉じた分が residue として残る（打鍵のたびに増える）。
   */
  private readonly _updateAfterRender = () => {
    this._pendingRender?.unsubscribe();
    this._pendingRender = this.inlineEditor.slots.renderComplete.subscribe(
      () => {
        this._pendingRender?.unsubscribe();
        this._pendingRender = null;
        this._updateFilteredItems();
      }
    );
  };

  private readonly _abortIfContextLost = () => {
    if (this._pendingContextCheck) clearTimeout(this._pendingContextCheck);
    this._pendingContextCheck = setTimeout(() => {
      this._pendingContextCheck = null;
      // ⚠️ 片付け済みなら何もしない（閉じたあとに走り得る）
      if (!this.isConnected) return;
      const current = this.inlineEditor.getInlineRange();
      const start = this._startRange;
      const query = this._query;
      if (
        !current ||
        !start ||
        // 起点より前へ戻った（Ctrl+Z など）
        current.index < start.index ||
        // 範囲が選択された（Ctrl+A など）
        current.length > 0 ||
        // ⚠️ **後ろへ飛び出した場合も閉じる**（Cmd+End・Ctrl+ArrowDown など）。
        // 起点より前だけを見ていると、**行末へ飛んでも残り**、
        // 起点から飛び先までの本文が丸ごとクエリになる（Codex 指摘）。
        // このメニューは空白で閉じる仕様なので、空白や改行を含んだ時点で
        // 「入力の続きではない」と判断できる
        query === null ||
        /[\s\u3000]/.test(query)
      ) {
        this.abortController.abort();
        return;
      }
      this._updateFilteredItems();
    }, 0);
  };

  private readonly _updateFilteredItems = () => {
    const query = this._query;
    if (query === null) {
      this.abortController.abort();
      return;
    }
    this._filteredItems = [];
    const searchStr = query.toLowerCase();
    if (searchStr === '' || searchStr.endsWith(' ')) {
      this._queryState = searchStr === '' ? 'off' : 'no_result';
      this._innerSlashMenuContext.searching = false;
      return;
    }

    // Layer order traversal
    let depth = 0;
    let queue = this.items;
    while (queue.length !== 0) {
      // remove the sub menu item from the previous layer result
      this._filteredItems = this._filteredItems.filter(
        item => !isSubMenuItem(item)
      );

      this._filteredItems = this._filteredItems.concat(
        queue.filter(({ name, searchAlias = [] }) =>
          [name, ...searchAlias].some(str => isFuzzyMatch(str, searchStr))
        )
      );

      // We search first and second layer
      if (this._filteredItems.length !== 0 && depth >= 1) break;

      queue = queue.flatMap(item => {
        if (isSubMenuItem(item)) {
          return item.subMenu;
        } else {
          return [];
        }
      });

      depth++;
    }

    this._filteredItems.sort((a, b) => {
      return -(
        substringMatchScore(a.name, searchStr) -
        substringMatchScore(b.name, searchStr)
      );
    });

    this._queryState = this._filteredItems.length === 0 ? 'no_result' : 'on';
    this._innerSlashMenuContext.searching = true;
  };

  private get _query() {
    return getTextContentFromInlineRange(this.inlineEditor, this._startRange);
  }

  get host() {
    return this.context.std.host;
  }

  constructor(
    private readonly inlineEditor: AffineInlineEditor,
    private readonly abortController = new AbortController()
  ) {
    super();
  }

  override connectedCallback() {
    super.connectedCallback();

    this._innerSlashMenuContext = {
      ...this.context,
      onClickItem: this._handleClickItem,
      searching: false,
    };

    this._initItemPathMap();

    this._disposables.addFromEvent(this, 'mousedown', e => {
      // Prevent input from losing focus
      e.preventDefault();
    });

    const inlineEditor = this.inlineEditor;
    if (!inlineEditor || !inlineEditor.eventSource) {
      console.error('inlineEditor or eventSource is not found');
      return;
    }

    /**
     * Handle arrow key
     *
     * The slash menu will be closed in the following keyboard cases:
     * - Press the space key
     * - Press the backspace key and the search string is empty
     * - Press the escape key
     * - When the search item is empty, the slash menu will be hidden temporarily,
     *   and if the following key is not the backspace key, the slash menu will be closed
     */
    createKeydownObserver({
      target: inlineEditor.eventSource,
      signal: this.abortController.signal,
      interceptor: (event, next) => {
        const { key, isComposing, code } = event;
        if (key === AFFINE_SLASH_MENU_TRIGGER_KEY) {
          // Can not stopPropagation here,
          // otherwise the rich text will not be able to trigger a new the slash menu
          return;
        }

        if (key === 'Process' && !isComposing && code === 'Slash') {
          // The IME case of above
          return;
        }

        if (key !== 'Backspace' && this._queryState === 'no_result') {
          if (isTextInputKey(event)) {
            // allow typing to change query; don't abort here
          } else {
            this.abortController.abort();
            return;
          }
        }

        if (key === 'Escape') {
          this.abortController.abort();
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (key === 'ArrowRight' || key === 'ArrowLeft') {
          return;
        }

        // #197: ⚠️ **修飾キーの組み合わせで、押された事実だけで閉じない。**
        //
        // 観測側（`createKeydownObserver`）は「修飾キー＋何か」を
        // 異常な操作とみなして一律に閉じる。しかし **IME の切り替えは
        // 修飾キーの組み合わせで行うのが普通**（Ctrl+Space / Alt+` など）で、
        // **日本語に切り替えた瞬間にメニューが消えていた**（#197・実機で確認）。
        //
        // ⚠️ **`isComposing` では見分けられない。** 切り替えキーを押した
        // 時点では変換がまだ始まっておらず、この値は false である。
        //
        // ⚠️ **キーを列挙して除外しない。** IME の切り替えキーは OS・
        // ブラウザ・IME の設定で違うため、列挙すると別の環境で再発する。
        //
        // 代わりに「**文脈が壊れたか**」で判断する。Ctrl+A や Ctrl+Z は
        // 選択や本文が変わるので閉じ、IME の切り替えは何も変えないので残る。
        if (isControlledKeyboardEvent(event)) {
          const isOnlyCmd =
            (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
          // 観測側が扱う移動・貼り付けと、修飾キー単独はそのまま通す
          if (
            (isOnlyCmd && ['p', 'n', 'v'].includes(key)) ||
            ['Control', 'Meta', 'Alt', 'Shift'].includes(key)
          ) {
            next();
            return;
          }
          this._abortIfContextLost();
          return;
        }

        next();
      },
      // #197: ⚠️ **いま読んで、描画後にもう一度読む。**
      //
      // IME（日本語・中国語・韓国語）の確定は `compositionend` で伝わるが、
      // **確定した文字が本文（yText）へ入る順序はブラウザによって違う**。
      // 片方だけにすると、順序が合わない環境で**絞り込みが効かなくなる**。
      //
      // ```
      // 即時だけ        … 確定文字が入る前に読むと、空のクエリで評価され
      //                   `_queryState` が 'off'（＝絞り込みなし）に落ちたまま戻らない
      // 描画待ちだけ    … 描画が起きない場合に一度も更新されない
      // 両方（この形）  … どちらの順序でも、最後には正しいクエリで評価される
      // ```
      //
      // ⚠️ **`isComposition` を見て分岐しないこと。** 分岐していたのが
      // #197 の原因で、**英語で試すと再現しない**ため気づけなかった。
      onInput: () => {
        // ⚠️ **即時の更新では閉じない。** 確定した文字が本文へ入る前だと
        // `_query` が null／空になり、`_updateFilteredItems` は
        // **メニューを閉じるか `_queryState` を 'off' に落とす**。
        // そのあと描画待ちの更新が届かず、直したはずの不具合に戻る。
        // 確実に文字がある場合だけ、先に絞り込む
        if (this._query) this._updateFilteredItems();
        this._updateAfterRender();
      },
      onPaste: () => {
        setTimeout(() => {
          this._updateFilteredItems();
        }, 50);
      },
      onDelete: () => {
        const curRange = this.inlineEditor.getInlineRange();
        if (!this._startRange || !curRange) {
          return;
        }
        if (curRange.index < this._startRange.index) {
          this.abortController.abort();
        }
        this._updateAfterRender();
      },
      onAbort: () => this.abortController.abort(),
    });

    this._telemetry?.track('OpenSlashMenu', {
      page: this._editorMode ?? undefined,
      type: this.context.model.flavour.split(':').pop(),
      module: 'slash menu',
    });
  }

  protected override willUpdate() {
    if (!this.hasUpdated) {
      const currRage = getCurrentNativeRange();
      if (!currRage) {
        this.abortController.abort();
        return;
      }

      // Handle position
      const updatePosition = throttle(() => {
        this._position = getPopperPosition(this, currRage);
      }, 10);

      this.disposables.addFromEvent(window, 'resize', updatePosition);
      updatePosition();
    }
  }

  override render() {
    const slashMenuStyles = this._position
      ? {
          transform: `translate(${this._position.x}, ${this._position.y})`,
          maxHeight: `${Math.min(this._position.height, AFFINE_SLASH_MENU_MAX_HEIGHT)}px`,
        }
      : {
          visibility: 'hidden',
        };

    return html`${this._queryState !== 'no_result'
        ? html` <div
            class="overlay-mask"
            @click="${() => this.abortController.abort()}"
          ></div>`
        : nothing}
      <inner-slash-menu
        .context=${this._innerSlashMenuContext}
        .menu=${this._queryState === 'off' ? this.items : this._filteredItems}
        .mainMenuStyle=${slashMenuStyles}
        .abortController=${this.abortController}
      >
      </inner-slash-menu>`;
  }

  @state()
  private accessor _filteredItems: (SlashMenuActionItem | SlashMenuSubMenu)[] =
    [];

  @state()
  private accessor _position: {
    x: string;
    y: string;
    height: number;
  } | null = null;

  @property({ attribute: false })
  accessor items!: SlashMenuItem[];

  @property({ attribute: false })
  accessor context!: SlashMenuContext;
}

export class InnerSlashMenu extends WithDisposable(LitElement) {
  static override styles = styles;

  private readonly _closeSubMenu = () => {
    this._subMenuAbortController?.abort();
    this._subMenuAbortController = null;
    this._currentSubMenu = null;
  };

  private _currentSubMenu: SlashMenuSubMenu | null = null;

  private readonly _openSubMenu = (item: SlashMenuSubMenu) => {
    if (item === this._currentSubMenu) return;

    const itemElement = this.shadowRoot?.querySelector(
      `.${slashItemClassName(item)}`
    );
    if (!itemElement) return;

    this._closeSubMenu();
    this._currentSubMenu = item;
    this._subMenuAbortController = new AbortController();
    this._subMenuAbortController.signal.addEventListener('abort', () => {
      this._closeSubMenu();
    });

    const { portal: subMenuElement } = createLitPortal({
      shadowDom: false,
      template: html`<inner-slash-menu
        .context=${this.context}
        .menu=${item.subMenu}
        .depth=${this.depth + 1}
        .abortController=${this._subMenuAbortController}
      >
        ${item.subMenu.map(this._renderItem)}
      </inner-slash-menu>`,
      computePosition: {
        referenceElement: itemElement,
        autoUpdate: true,
        middleware: [
          offset(12),
          autoPlacement({
            allowedPlacements: ['right-start', 'right-end'],
          }),
        ],
      },
      abortController: this._subMenuAbortController,
    });

    subMenuElement.style.zIndex = `calc(var(--affine-z-index-popover) + ${this.depth})`;
    subMenuElement.focus();
  };

  private readonly _renderActionItem = (item: SlashMenuActionItem) => {
    const { name, icon, description, tooltip } = item;

    const hover = item === this._activeItem;

    return html`<icon-button
      class="slash-menu-item ${slashItemClassName(item)}"
      width="100%"
      height="44px"
      text=${name}
      subText=${ifDefined(description)}
      data-testid="${name}"
      hover=${hover}
      @mousemove=${() => {
        this._activeItem = item;
        this._closeSubMenu();
      }}
      @click=${() => this.context.onClickItem(item)}
    >
      ${icon && html`<div class="slash-menu-item-icon">${icon}</div>`}
      ${tooltip &&
      html`<affine-tooltip
        tip-position="right"
        .offset=${22}
        .tooltipStyle=${slashItemToolTipStyle}
        .hoverOptions=${{
          enterDelay: AFFINE_SLASH_MENU_TOOLTIP_TIMEOUT,
          allowMultiple: false,
        }}
      >
        <div class="tooltip-figure">${tooltip.figure}</div>
        <div class="tooltip-caption">
          ${tooltip.caption ? translateSlashItem(tooltip.caption).name : ''}
        </div>
      </affine-tooltip>`}
    </icon-button>`;
  };

  private readonly _renderGroup = (
    groupName: string,
    items: SlashMenuItem[]
  ) => {
    return html`<div class="slash-menu-group">
      ${when(
        !this.context.searching,
        () => html`<div class="slash-menu-group-name">${groupName}</div>`
      )}
      ${items.map(this._renderItem)}
    </div>`;
  };

  private readonly _renderItem = (item: SlashMenuItem) => {
    if (isActionItem(item)) return this._renderActionItem(item);
    if (isSubMenuItem(item)) return this._renderSubMenuItem(item);
    return nothing;
  };

  private readonly _renderSubMenuItem = (item: SlashMenuSubMenu) => {
    const { name, icon, description } = item;

    const hover = item === this._activeItem;

    return html`<icon-button
      class="slash-menu-item ${slashItemClassName(item)}"
      width="100%"
      height="44px"
      text=${name}
      subText=${ifDefined(description)}
      data-testid="${name}"
      hover=${hover}
      @mousemove=${() => {
        this._activeItem = item;
        this._openSubMenu(item);
      }}
      @touchstart=${() => {
        isSubMenuItem(item) &&
          (this._currentSubMenu === item
            ? this._closeSubMenu()
            : this._openSubMenu(item));
      }}
    >
      ${icon && html`<div class="slash-menu-item-icon">${icon}</div>`}
      <div slot="suffix" style="transform: rotate(-90deg);">
        ${ArrowDownSmallIcon()}
      </div>
    </icon-button>`;
  };

  private _subMenuAbortController: AbortController | null = null;

  private _scrollToItem(item: SlashMenuItem) {
    const shadowRoot = this.shadowRoot;
    if (!shadowRoot) {
      return;
    }

    const ele = shadowRoot.querySelector(`icon-button[text="${item.name}"]`);
    if (!ele) {
      return;
    }
    ele.scrollIntoView({
      block: 'nearest',
    });
  }

  override connectedCallback() {
    super.connectedCallback();

    // close all sub menus
    this.abortController?.signal?.addEventListener('abort', () => {
      this._subMenuAbortController?.abort();
    });
    this.addEventListener('wheel', event => {
      if (this._currentSubMenu) {
        event.preventDefault();
      }
    });

    const inlineEditor = getInlineEditorByModel(
      this.context.std,
      this.context.model
    );

    if (!inlineEditor || !inlineEditor.eventSource) {
      console.error('inlineEditor or eventSource is not found');
      return;
    }

    inlineEditor.eventSource.addEventListener(
      'keydown',
      event => {
        if (this._currentSubMenu) return;
        if (event.isComposing) return;

        const { key, ctrlKey, metaKey, altKey, shiftKey } = event;

        const onlyCmd = (ctrlKey || metaKey) && !altKey && !shiftKey;
        const onlyShift = shiftKey && !isControlledKeyboardEvent(event);
        const notControlShift = !(ctrlKey || metaKey || altKey || shiftKey);

        let moveStep = 0;
        if (
          (key === 'ArrowUp' && notControlShift) ||
          (key === 'Tab' && onlyShift) ||
          (key === 'P' && onlyCmd) ||
          (key === 'p' && onlyCmd)
        ) {
          moveStep = -1;
        }

        if (
          (key === 'ArrowDown' && notControlShift) ||
          (key === 'Tab' && notControlShift) ||
          (key === 'n' && onlyCmd) ||
          (key === 'N' && onlyCmd)
        ) {
          moveStep = 1;
        }

        if (moveStep !== 0) {
          const activeItemIndex = this.menu.indexOf(this._activeItem);
          const itemIndex =
            (activeItemIndex + moveStep + this.menu.length) % this.menu.length;

          this._activeItem = this.menu[itemIndex] as typeof this._activeItem;
          this._scrollToItem(this._activeItem);

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'ArrowRight' && notControlShift) {
          if (isSubMenuItem(this._activeItem)) {
            this._openSubMenu(this._activeItem);
          }

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'ArrowLeft' && notControlShift) {
          if (this.depth != 0) this.abortController.abort();

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'Escape' && notControlShift) {
          this.abortController.abort();

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'Enter' && notControlShift) {
          if (isSubMenuItem(this._activeItem)) {
            this._openSubMenu(this._activeItem);
          } else if (isActionItem(this._activeItem)) {
            this.context.onClickItem(this._activeItem);
          }

          event.preventDefault();
          event.stopPropagation();
        }
      },
      {
        capture: true,
        signal: this.abortController.signal,
      }
    );
  }

  override disconnectedCallback() {
    this.abortController.abort();
  }

  override render() {
    if (this.menu.length === 0) return nothing;

    const style = styleMap(this.mainMenuStyle ?? { position: 'relative' });

    const groups = groupBy(this.menu, ({ group }) =>
      group && !this.context.searching ? parseGroup(group)[1] : ''
    );

    return html`<div
      class="slash-menu"
      style=${style}
      data-testid=${`sub-menu-${this.depth}`}
    >
      ${Object.entries(groups).map(([groupName, items]) =>
        this._renderGroup(groupName, items)
      )}
    </div>`;
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('menu') && this.menu.length !== 0) {
      this._activeItem = this.menu[0];

      // this case happen on query updated
      this._subMenuAbortController?.abort();
    }
  }

  @state()
  private accessor _activeItem!: SlashMenuActionItem | SlashMenuSubMenu;

  @property({ attribute: false })
  accessor abortController!: AbortController;

  @property({ attribute: false })
  accessor context!: InnerSlashMenuContext;

  @property({ attribute: false })
  accessor depth: number = 0;

  @property({ attribute: false })
  accessor mainMenuStyle: Parameters<typeof styleMap>[0] | null = null;

  @property({ attribute: false })
  accessor menu!: SlashMenuItem[];
}
