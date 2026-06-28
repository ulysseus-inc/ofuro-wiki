import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import {
  ColumnCellBlockFlavour,
  ColumnCellBlockSchemaExtension,
  ColumnsBlockFlavour,
  ColumnsBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { SlashMenuConfigExtension } from '@blocksuite/affine-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { columnsSlashMenuConfig } from './configs/slash-menu';
import { effects } from './effects';

export class ColumnsViewExtension extends ViewExtensionProvider {
  override name = 'affine-columns-block';

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      ColumnsBlockSchemaExtension,
      FlavourExtension(ColumnsBlockFlavour),
      BlockViewExtension(ColumnsBlockFlavour, literal`affine-columns`),
      SlashMenuConfigExtension(ColumnsBlockFlavour, columnsSlashMenuConfig),
      ColumnCellBlockSchemaExtension,
      FlavourExtension(ColumnCellBlockFlavour),
      BlockViewExtension(ColumnCellBlockFlavour, literal`affine-column-cell`),
    ]);
  }
}
