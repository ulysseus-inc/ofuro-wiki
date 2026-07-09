import { DefaultTool } from '@blocksuite/affine-block-surface';
import { toggleEmbedCardCreateModal } from '@blocksuite/affine-components/embed-card-modal';
import {
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import type { SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { GithubDuotoneIcon } from '@blocksuite/icons/lit';
import { GfxControllerIdentifier } from '@blocksuite/std/gfx';

import { GithubRepoTooltip } from './tooltips';

export const embedGithubSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const t = translateSlashItem('GitHub', 'Link to a GitHub repository.');
    return [
    {
      name: t.name,
      description: t.description,
      icon: GithubDuotoneIcon(),
      tooltip: {
        figure: GithubRepoTooltip,
        caption: 'GitHub Repo',
      },
      group: translateGroupStr('4_Content & Media@7'),
      when: ({ model }) =>
        model.store.schema.flavourSchemaMap.has('affine:embed-github'),
      action: ({ std, model }) => {
        (async () => {
          const { host } = std;
          const parentModel = host.store.getParent(model);
          if (!parentModel) {
            return;
          }
          const index = parentModel.children.indexOf(model) + 1;
          await toggleEmbedCardCreateModal(
            host,
            'GitHub',
            'The added GitHub issue or pull request link will be displayed as a card view.',
            { mode: 'page', parentModel, index },
            ({ mode }) => {
              if (mode === 'edgeless') {
                const gfx = std.get(GfxControllerIdentifier);
                gfx.tool.setTool(DefaultTool);
              }
            }
          );
          if (model.text?.length === 0) std.store.deleteBlock(model);
        })().catch(console.error);
      },
    },
    ];
  },
};
