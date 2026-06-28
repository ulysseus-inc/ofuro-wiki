import { ColumnCellBlockComponent } from './column-cell-block';
import { ColumnsBlockComponent } from './columns-block';

export function effects() {
  customElements.define('affine-columns', ColumnsBlockComponent);
  customElements.define('affine-column-cell', ColumnCellBlockComponent);
}
