import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import {
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { ImageIcon } from '@blocksuite/icons/lit';

import { insertImagesCommand } from '../commands';
import { PhotoTooltip } from './tooltips';

export const imageSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const t = translateSlashItem('Image', 'Insert an image.');
    return [
      {
        name: t.name,
        description: t.description,
        icon: ImageIcon(),
        tooltip: {
          figure: PhotoTooltip,
          caption: 'Photo',
        },
        group: translateGroupStr('4_Content & Media@1'),
        when: ({ model }) =>
          model.store.schema.flavourSchemaMap.has('affine:image'),
        action: ({ std }) => {
          const [success, ctx] = std.command
            .chain()
            .pipe(getSelectedModelsCommand)
            .pipe(insertImagesCommand, { removeEmptyLine: true })
            .run();

          if (success) ctx.insertedImageIds.catch(console.error);
        },
      },
    ];
  },
};
