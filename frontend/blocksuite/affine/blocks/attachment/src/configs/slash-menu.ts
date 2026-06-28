import { openSingleFileWith } from '@blocksuite/affine-shared/utils';
import {
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { ExportToPdfIcon, FileIcon } from '@blocksuite/icons/lit';

import { addSiblingAttachmentBlocks } from '../utils';
import { AttachmentTooltip, PDFTooltip } from './tooltips';

export const attachmentSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const attT = translateSlashItem('Attachment', 'Attach a file to document.');
    const pdfT = translateSlashItem('PDF', 'Upload a PDF to document.');
    return [
      {
        name: attT.name,
        description: attT.description,
        icon: FileIcon(),
        tooltip: {
          figure: AttachmentTooltip,
          caption: 'Attachment',
        },
        searchAlias: ['file'],
        group: translateGroupStr('4_Content & Media@3'),
        when: ({ model }) =>
          model.store.schema.flavourSchemaMap.has('affine:attachment'),
        action: ({ std, model }) => {
          (async () => {
            const file = await openSingleFileWith();
            if (!file) return;

            await addSiblingAttachmentBlocks(std, [file], model);
            if (model.text?.length === 0) {
              std.store.deleteBlock(model);
            }
          })().catch(console.error);
        },
      },
      {
        name: pdfT.name,
        description: pdfT.description,
        icon: ExportToPdfIcon(),
        tooltip: {
          figure: PDFTooltip,
          caption: 'PDF',
        },
        group: translateGroupStr('4_Content & Media@4'),
        when: ({ model }) =>
          model.store.schema.flavourSchemaMap.has('affine:attachment'),
        action: ({ std, model }) => {
          (async () => {
            const file = await openSingleFileWith();
            if (!file) return;

            await addSiblingAttachmentBlocks(std, [file], model);
            if (model.text?.length === 0) {
              std.store.deleteBlock(model);
            }
          })().catch(console.error);
        },
      },
    ];
  },
};
