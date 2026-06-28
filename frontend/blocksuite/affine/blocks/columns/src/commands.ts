import {
  ColumnCellBlockFlavour,
  ColumnsBlockFlavour,
} from '@blocksuite/affine-model';
import type { Command } from '@blocksuite/std';
import { type BlockModel } from '@blocksuite/store';

export const insertColumnsBlockCommand: Command<
  {
    place?: 'after' | 'before';
    removeEmptyLine?: boolean;
    selectedModels?: BlockModel[];
    columnCount?: number;
  },
  {
    insertedColumnsBlockId: string;
  }
> = (ctx, next) => {
  const { selectedModels, place, removeEmptyLine, std, columnCount = 2 } = ctx;
  if (!selectedModels?.length) return;

  const targetModel =
    place === 'before'
      ? selectedModels[0]
      : selectedModels[selectedModels.length - 1];

  if (!targetModel) return;

  // カラムブロックを挿入する
  const result = std.store.addSiblingBlocks(
    targetModel,
    [{ flavour: ColumnsBlockFlavour, columnCount }],
    place
  );
  const blockId = result[0];

  if (blockId == null) return;

  // 指定した列数分のカラムセルブロックを子として追加し、各セルに段落を入れる
  const columnsModel = std.store.getBlock(blockId)?.model;
  if (columnsModel) {
    for (let i = 0; i < columnCount; i++) {
      const cellId = std.store.addBlock(
        ColumnCellBlockFlavour,
        {},
        blockId
      );
      if (cellId) {
        std.store.addBlock('affine:paragraph', {}, cellId);
      }
    }
  }

  if (removeEmptyLine && targetModel.text?.length === 0) {
    std.store.deleteBlock(targetModel);
  }

  // カラムブロックの後に空の段落を追加して、カラム外の編集を可能にする
  if (columnsModel) {
    std.store.addSiblingBlocks(
      columnsModel,
      [{ flavour: 'affine:paragraph', props: {} }],
      'after'
    );
  }

  next({ insertedColumnsBlockId: blockId });
};
