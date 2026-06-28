import { builtInTemplates as builtInEdgelessTemplates } from '@ofuro/templates/edgeless';
import { builtInTemplates as builtInStickersTemplates } from '@ofuro/templates/stickers';
import {
  EdgelessTemplatePanel,
  type TemplateManager,
} from '@blocksuite/affine/gfx/template';

export function registerTemplates() {
  EdgelessTemplatePanel.templates.extend(
    builtInStickersTemplates as TemplateManager
  );
  EdgelessTemplatePanel.templates.extend(
    builtInEdgelessTemplates as TemplateManager
  );
}
