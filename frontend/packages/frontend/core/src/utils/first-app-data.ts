// the following import is used to ensure the block suite editor effects are run
import '../blocksuite/block-suite-editor';

import onboardingUrl from '@ofuro/templates/onboarding.zip';
import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';

import { DocsService } from '../modules/doc';
import { OrganizeService } from '../modules/organize';
import { createWikiTemplates } from '../modules/template-doc/wiki-templates';
import {
  getAFFiNEWorkspaceSchema,
  type WorkspacesService,
} from '../modules/workspace';

export async function buildShowcaseWorkspace(
  workspacesService: WorkspacesService,
  flavour: string,
  workspaceName: string
) {
  const meta = await workspacesService.create(flavour, async docCollection => {
    docCollection.meta.initialize();
    docCollection.doc.getMap('meta').set('name', workspaceName);
    try {
      const blob = await (await fetch(onboardingUrl)).blob();
      await ZipTransformer.importDocs(
        docCollection,
        getAFFiNEWorkspaceSchema(),
        blob
      );
    } catch (e) {
      console.warn('Failed to import onboarding templates:', e);
    }
  });

  const { workspace, dispose } = workspacesService.open({ metadata: meta });

  await workspace.engine.doc.waitForDocReady(workspace.id);

  const docsService = workspace.scope.get(DocsService);

  // should jump to "はじめに"
  const defaultDoc = docsService.list.docs$.value.find(p =>
    p.title$.value.startsWith('はじめに')
  );
  const folderTutorialDoc = docsService.list.docs$.value.find(p =>
    p.title$.value.startsWith('フォルダとタグの使い方')
  );

  // create default organize
  if (folderTutorialDoc) {
    try {
      const organizeService = workspace.scope.get(OrganizeService);
      const folderId = organizeService.folderTree.rootFolder.createFolder(
        'はじめてのフォルダ',
        organizeService.folderTree.rootFolder.indexAt('after')
      );
      const firstFolderNode =
        organizeService.folderTree.folderNode$(folderId).value;
      firstFolderNode?.createLink(
        'doc',
        folderTutorialDoc.id,
        firstFolderNode.indexAt('after')
      );
    } catch (e) {
      console.warn('Failed to create default folder structure:', e);
    }
  }

  // Wait for onboarding docs to fully sync before creating templates.
  // createWikiTemplates() must run AFTER waitForSynced() to avoid
  // "Cycle detected" Yjs errors caused by concurrent doc initialization.
  try {
    await workspace.engine.doc.waitForSynced();
  } catch (e) {
    console.warn('Sync timeout during workspace initialization:', e);
  }

  // Create wiki templates after onboarding docs are stable
  try {
    createWikiTemplates(docsService);
    await workspace.engine.doc.waitForSynced();
  } catch (e) {
    console.warn('Failed to create wiki templates:', e);
  }

  dispose();

  return { meta, defaultDocId: defaultDoc?.id };
}

