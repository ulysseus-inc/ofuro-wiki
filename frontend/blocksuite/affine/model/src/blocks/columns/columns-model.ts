import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

// --- affine:columns (親コンテナ) ---

export const ColumnsBlockFlavour = 'affine:columns' as const;

export interface ColumnsProps {
  columnCount: number;
}

export const ColumnsBlockSchema = defineBlockSchema({
  flavour: ColumnsBlockFlavour,
  props: (): ColumnsProps => ({
    columnCount: 2,
  }),
  metadata: {
    version: 1,
    role: 'hub',
    parent: ['affine:note'],
    children: ['affine:column-cell'],
  },
  toModel: () => new ColumnsBlockModel(),
});

export const ColumnsBlockSchemaExtension =
  BlockSchemaExtension(ColumnsBlockSchema);

export class ColumnsBlockModel extends BlockModel<ColumnsProps> {}

// --- affine:column-cell (各列のコンテナ) ---

export const ColumnCellBlockFlavour = 'affine:column-cell' as const;

export const ColumnCellBlockSchema = defineBlockSchema({
  flavour: ColumnCellBlockFlavour,
  props: () => ({}),
  metadata: {
    version: 1,
    role: 'hub',
    parent: ['affine:columns'],
    children: [
      '@content',
      'affine:database',
      'affine:data-view',
      'affine:callout',
    ],
  },
  toModel: () => new ColumnCellBlockModel(),
});

export const ColumnCellBlockSchemaExtension =
  BlockSchemaExtension(ColumnCellBlockSchema);

export class ColumnCellBlockModel extends BlockModel {}
