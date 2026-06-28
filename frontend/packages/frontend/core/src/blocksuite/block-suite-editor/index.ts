import { editorEffects } from '@ofuro/core/blocksuite/editors';

import { registerTemplates } from './register-templates';

editorEffects();
// AI editor effects removed in ofuro-wiki
registerTemplates();

export * from './blocksuite-editor';
