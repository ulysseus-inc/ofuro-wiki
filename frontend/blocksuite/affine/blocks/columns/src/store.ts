import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import {
  ColumnCellBlockSchemaExtension,
  ColumnsBlockSchemaExtension,
} from '@blocksuite/affine-model';

export class ColumnsStoreExtension extends StoreExtensionProvider {
  override name = 'affine-columns-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(ColumnsBlockSchemaExtension);
    context.register(ColumnCellBlockSchemaExtension);
  }
}
