import { EmbedLinkedDocBlockSchema } from '@blocksuite/affine-model';
import { insertContent } from '@blocksuite/affine-rich-text';
import { REFERENCE_NODE } from '@blocksuite/affine-shared/consts';
import {
  createDefaultDoc,
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import {
  type SlashMenuConfig,
  SlashMenuConfigIdentifier,
} from '@blocksuite/affine-widget-slash-menu';
import { LinkedPageIcon, PlusIcon } from '@blocksuite/icons/lit';
import { type ExtensionType } from '@blocksuite/store';

import { LinkDocTooltip, NewDocTooltip } from './tooltips';

const linkedDocSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const newDocT = translateSlashItem('New Doc', 'Start a new document.');
    const linkedDocT = translateSlashItem('Linked Doc', 'Link to another document.');
    return [
      {
        name: newDocT.name,
        description: newDocT.description,
        icon: PlusIcon(),
        tooltip: {
          figure: NewDocTooltip,
          caption: 'New Doc',
        },
        group: translateGroupStr('3_Page@0'),
        when: ({ model }) =>
          model.store.schema.flavourSchemaMap.has('affine:embed-linked-doc'),
        action: ({ std, model }) => {
          const newDoc = createDefaultDoc(std.host.store.workspace);
          insertContent(std, model, REFERENCE_NODE, {
            reference: {
              type: 'LinkedPage',
              pageId: newDoc.id,
            },
          });
        },
      },
      {
        name: linkedDocT.name,
        description: linkedDocT.description,
        icon: LinkedPageIcon(),
        tooltip: {
          figure: LinkDocTooltip,
          caption: 'Link Doc',
        },
        searchAlias: ['dual link'],
        group: translateGroupStr('3_Page@1'),
        when: ({ std, model }) => {
          const root = model.store.root;
          if (!root) return false;
          const linkedDocWidget = std.view.getWidget(
            'affine-linked-doc-widget',
            root.id
          );
          if (!linkedDocWidget) return false;

          return model.store.schema.flavourSchemaMap.has(
            'affine:embed-linked-doc'
          );
        },
        action: ({ model, std }) => {
          const root = model.store.root;
          if (!root) return;
          const linkedDocWidget = std.view.getWidget(
            'affine-linked-doc-widget',
            root.id
          );
          if (!linkedDocWidget) return;
          // TODO(@L-Sun): make linked-doc-widget as extension
          // @ts-expect-error same as above
          linkedDocWidget.show({ addTriggerKey: true });
        },
      },
    ];
  },
};

export const LinkedDocSlashMenuConfigIdentifier = SlashMenuConfigIdentifier(
  EmbedLinkedDocBlockSchema.model.flavour
);

export const LinkedDocSlashMenuConfigExtension: ExtensionType = {
  setup: di => {
    di.addImpl(LinkedDocSlashMenuConfigIdentifier, linkedDocSlashMenuConfig);
  },
};
