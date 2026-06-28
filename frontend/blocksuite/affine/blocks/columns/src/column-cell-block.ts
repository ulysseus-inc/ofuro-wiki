import type { ColumnCellBlockModel } from '@blocksuite/affine-model';
import { BlockComponent } from '@blocksuite/std';
import { css, html } from 'lit';

import { RecoverableRenderMixin } from './recoverable-block';

export class ColumnCellBlockComponent extends RecoverableRenderMixin(
  BlockComponent<ColumnCellBlockModel>
) {
  static override styles = css`
    affine-column-cell {
      display: block;
      min-width: 0;
      padding: 8px 12px;
    }
  `;

  override renderBlock() {
    return html`
      <div class="affine-column-cell-container">
        <div class="affine-block-children-container">
          ${this.renderChildren(this.model)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-column-cell': ColumnCellBlockComponent;
  }
}
