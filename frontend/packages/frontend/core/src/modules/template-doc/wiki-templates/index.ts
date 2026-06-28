import { getOrCreateI18n } from '@ofuro/i18n';

import type { DocsService } from '../../doc';
import { wikiTemplates } from './definitions';

export function createWikiTemplates(docsService: DocsService) {
  const i18n = getOrCreateI18n();
  const lang = i18n.language?.startsWith('ja') ? 'ja' : 'en';

  for (const template of wikiTemplates) {
    docsService.createDoc({
      isTemplate: true,
      title: template.title[lang],
      docProps: {
        onStoreLoad: (doc, { noteId, paragraphId }) => {
          // Remove the default empty paragraph
          const block = doc.getBlock(paragraphId);
          if (block) doc.deleteBlock(block.model);
          // Build template content
          template.build(doc, noteId, lang);
        },
      },
    });
  }
}
