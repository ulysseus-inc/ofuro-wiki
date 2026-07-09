import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import {
  isInsideBlockByFlavour,
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import type { SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { LayoutIcon } from '@blocksuite/icons/lit';

import { insertColumnsBlockCommand } from '../commands';

export const columnsSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const t2 = translateSlashItem('2 Columns', 'Create a 2 column layout.');
    const t3 = translateSlashItem('3 Columns', 'Create a 3 column layout.');
    return [
    {
      name: t2.name,
      description: t2.description,
      searchAlias: ['2 columns', 'column'],
      icon: LayoutIcon(),
      group: translateGroupStr('5_Edgeless Element@10'),
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
      name: t3.name,
      description: t3.description,
      searchAlias: ['3 columns', 'column'],
      icon: LayoutIcon(),
      group: translateGroupStr('5_Edgeless Element@11'),
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
    ];
  },
};
