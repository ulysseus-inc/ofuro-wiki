import {
  getImageFilesFromLocal,
  notifyFileOpenFailed,
} from '@blocksuite/affine-shared/utils';
import type { Command } from '@blocksuite/std';
import type { BlockModel } from '@blocksuite/store';

import { addSiblingImageBlocks } from '../utils';

export const insertImagesCommand: Command<
  {
    selectedModels?: BlockModel[];
    removeEmptyLine?: boolean;
    placement?: 'after' | 'before';
  },
  {
    insertedImageIds: Promise<string[]>;
  }
> = (ctx, next) => {
  const { selectedModels, placement, removeEmptyLine, std } = ctx;
  if (!selectedModels?.length) return;

  const targetModel =
    placement === 'before'
      ? selectedModels[0]
      : selectedModels[selectedModels.length - 1];

  return next({
    insertedImageIds: getImageFilesFromLocal()
      // ファイル選択の失敗をここで受け止める。呼び出し元は insertedImageIds を
      // await するため、未処理の rejection にすると「押しても何も起きない」状態になる
      .catch((err: unknown) => {
        notifyFileOpenFailed(std, err);
        return null;
      })
      .then(files =>
        files ? addSiblingImageBlocks(std, files, targetModel, placement) : []
      )
      .then(result => {
        if (
          result.length &&
          removeEmptyLine &&
          targetModel.text?.length === 0
        ) {
          std.store.deleteBlock(targetModel);
        }

        return result;
      }),
  });
};
