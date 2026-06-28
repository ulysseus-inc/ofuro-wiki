import type { ColumnsBlockModel } from '@blocksuite/affine-model';
import { BlockComponent } from '@blocksuite/std';
import { css, html } from 'lit';

import { RecoverableRenderMixin } from './recoverable-block';

export class ColumnsBlockComponent extends RecoverableRenderMixin(
  BlockComponent<ColumnsBlockModel>
) {
  static override styles = css`
    affine-columns {
      display: block;
      width: 100%;
      margin: 8px 0;
    }
    .affine-columns-container {
      display: grid;
      gap: 0;
      width: 100%;
      align-items: start;
      border: 1px solid transparent;
      border-radius: 4px;
      transition: border-color 0.2s ease;
    }
    affine-columns:hover .affine-columns-container {
      border-color: var(--affine-border-color, #e3e3e3);
    }
    .affine-columns-container > affine-column-cell {
      min-width: 0;
      border-right: 1px solid transparent;
      transition: border-color 0.2s ease;
    }
    affine-columns:hover .affine-columns-container > affine-column-cell {
      border-color: var(--affine-border-color, #e3e3e3);
    }
    .affine-columns-container > affine-column-cell:last-child {
      border-right: none;
    }
  `;

  override renderBlock() {
    const columnCount = this.model.props.columnCount ?? 2;
    const gridStyle = `grid-template-columns: repeat(${columnCount}, 1fr);`;

    return html`
      <div class="affine-columns-container" style="${gridStyle}">
        ${this.renderChildren(this.model)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-columns': ColumnsBlockComponent;
  }
}
