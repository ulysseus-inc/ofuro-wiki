import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import { isInsideBlockByFlavour } from '@blocksuite/affine-shared/utils';
import type { SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { LayoutIcon } from '@blocksuite/icons/lit';

import { insertColumnsBlockCommand } from '../commands';

export const columnsSlashMenuConfig: SlashMenuConfig = {
  items: () => [
    {
      name: '2列',
      description: '2列のレイアウトを作成します。',
      icon: LayoutIcon(),
      group: '4_Content & Media@10',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text') &&
        !isInsideBlockByFlavour(model.store, model, 'affine:columns'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertColumnsBlockCommand, {
            place: 'after',
            removeEmptyLine: true,
            columnCount: 2,
          })
          .run();
      },
    },
    {
      name: '3列',
      description: '3列のレイアウトを作成します。',
      icon: LayoutIcon(),
      group: '4_Content & Media@11',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text') &&
        !isInsideBlockByFlavour(model.store, model, 'affine:columns'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertColumnsBlockCommand, {
            place: 'after',
            removeEmptyLine: true,
            columnCount: 3,
          })
          .run();
      },
    },
  ],
};
