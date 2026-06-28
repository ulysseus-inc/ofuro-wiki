import { insertInlineLatex } from '@blocksuite/affine-inline-latex';
import {
  getSelectedModelsCommand,
  getTextSelectionCommand,
} from '@blocksuite/affine-shared/commands';
import {
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { TeXIcon } from '@blocksuite/icons/lit';

import { insertLatexBlockCommand } from '../commands';
import { LatexTooltip } from './tooltips';

export const latexSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const inlineT = translateSlashItem('Inline equation', 'Create a inline equation.');
    const eqT = translateSlashItem('Equation', 'Create a equation block.');
    return [
      {
        name: inlineT.name,
        group: translateGroupStr('0_Basic@8'),
        description: inlineT.description,
        icon: TeXIcon(),
        tooltip: {
          figure: LatexTooltip(
            'Energy. Mass. Light. In a single equation,',
            'E=mc^2',
            false
          ),
          caption: 'Inline equation',
        },
        searchAlias: ['inlineMath, inlineEquation', 'inlineLatex'],
        action: ({ std }) => {
          std.command
            .chain()
            .pipe(getTextSelectionCommand)
            .pipe(insertInlineLatex)
            .run();
        },
      },
      {
        name: eqT.name,
        description: eqT.description,
        icon: TeXIcon(),
        tooltip: {
          figure: LatexTooltip(
            'Create a equation via LaTeX.',
            String.raw`\frac{a}{b} \pm \frac{c}{d} = \frac{ad \pm bc}{bd}`,
            true
          ),
          caption: 'Equation',
        },
        searchAlias: ['mathBlock, equationBlock', 'latexBlock'],
        group: translateGroupStr('4_Content & Media@10'),
        action: ({ std }) => {
          std.command
            .chain()
            .pipe(getSelectedModelsCommand)
            .pipe(insertLatexBlockCommand, {
              place: 'after',
              removeEmptyLine: true,
            })
            .run();
        },
      },
    ];
  },
};
