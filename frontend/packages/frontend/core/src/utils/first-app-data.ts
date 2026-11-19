// the following import is used to ensure the block suite editor effects are run
import '../blocksuite/block-suite-editor';

import onboardingUrl from '@ofuro/templates/onboarding.zip';
import onboardingEnUrl from '@ofuro/templates/onboarding-en.zip';
import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { getOrCreateI18n } from '@ofuro/i18n';

import { type DocRecord, DocsService } from '../modules/doc';
import { OrganizeService } from '../modules/organize';
import { createWikiTemplates } from '../modules/template-doc/wiki-templates';
import {
  type CreateWorkspaceOptions,
  getAFFiNEWorkspaceSchema,
  type WorkspacesService,
} from '../modules/workspace';
import {
  type OnboardingContent,
  onboardingContent,
  type OnboardingLocale,
} from './onboarding-content';

/** 言語ごとの見本の zip */
const ONBOARDING_ZIP: Record<OnboardingLocale, string> = {
  ja: onboardingUrl,
  en: onboardingEnUrl,
};

/** 見本が一覧に載るのを待つ最長と、見に行く間隔（docs/first-workspace.md） */
const ONBOARDING_WAIT_MS = 60_000;
const ONBOARDING_POLL_MS = 500;

/** 取り込んだ見本のうち、作成の処理が使う 2 ページ */
interface OnboardingDocs {
  intro?: DocRecord;
  folderGuide?: DocRecord;
}

/** 一覧から見本を題で探す */
function findOnboarding(
  docsService: DocsService,
  content: OnboardingContent
): OnboardingDocs {
  const docs = docsService.list.docs$.value;
  return {
    intro: docs.find(p => p.title$.value.startsWith(content.introTitle)),
    folderGuide: docs.find(p =>
      p.title$.value.startsWith(content.folderGuideTitle)
    ),
  };
}

/**
 * 一覧の準備ができ、見本の 2 ページが載るまで待つ。
 *
 * 一覧はサーバーの台帳から作るため、作った直後は空。待たずに進むと、
 * 最初のフォルダもテンプレートも作れない（docs/first-workspace.md）。
 * ⚠️ 呼ぶ側が一覧を購読しておくこと。購読が無いと一覧は台帳を取りに行かない。
 * 最長で待っても揃わなければ、見つかったものだけを返す。
 */
async function waitForOnboarding(
  docsService: DocsService,
  content: OnboardingContent,
  workspaceId: string
): Promise<OnboardingDocs> {
  const deadline = Date.now() + ONBOARDING_WAIT_MS;

  while (Date.now() < deadline) {
    const found = findOnboarding(docsService, content);
    if (docsService.list.isReady$.value && found.intro && found.folderGuide) {
      return found;
    }
    await new Promise(resolve => setTimeout(resolve, ONBOARDING_POLL_MS));
  }

  console.warn('Onboarding docs did not appear in the doc list in time', {
    workspaceId,
  });
  return findOnboarding(docsService, content);
}

export async function buildShowcaseWorkspace(
  workspacesService: WorkspacesService,
  flavour: string,
  workspaceName: string,
  // #297: 省くとプライベート（最初のサインイン）。作成のダイアログは共有を作る
  options?: CreateWorkspaceOptions
) {
  // 見本は作るときの画面の言語で選ぶ（docs/first-workspace.md）
  const content = onboardingContent(getOrCreateI18n().language ?? '');
  const zipUrl = ONBOARDING_ZIP[content.locale];

  const meta = await workspacesService.create(
    flavour,
    async docCollection => {
      docCollection.meta.initialize();
      docCollection.doc.getMap('meta').set('name', workspaceName);
      try {
        const blob = await (await fetch(zipUrl)).blob();
        await ZipTransformer.importDocs(
          docCollection,
          getAFFiNEWorkspaceSchema(),
          blob
        );
      } catch (e) {
        console.warn('Failed to import onboarding templates:', e);
      }
    },
    options
  );

  const { workspace, dispose } = workspacesService.open({ metadata: meta });

  await workspace.engine.doc.waitForDocReady(workspace.id);

  const docsService = workspace.scope.get(DocsService);

  // 作り終えるまで一覧を購読しておく（購読が無いと台帳を取りに行かず、空のまま）
  const listening = [
    docsService.list.docs$.subscribe(() => {}),
    docsService.list.isReady$.subscribe(() => {}),
  ];

  // 最初に開くページと、フォルダに入れるページ
  const { intro: defaultDoc, folderGuide: folderTutorialDoc } =
    await waitForOnboarding(docsService, content, workspace.id);

  // create default organize
  if (folderTutorialDoc) {
    try {
      const organizeService = workspace.scope.get(OrganizeService);
      const folderId = organizeService.folderTree.rootFolder.createFolder(
        content.folderName,
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

  listening.forEach(s => s.unsubscribe());
  dispose();

  return { meta, defaultDocId: defaultDoc?.id };
}
