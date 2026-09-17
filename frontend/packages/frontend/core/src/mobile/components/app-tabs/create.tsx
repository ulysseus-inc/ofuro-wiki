import { useI18n } from '@ofuro/i18n';
import { usePageHelper } from '@ofuro/core/blocksuite/block-suite-page-list/utils';
import { useAsyncCallback } from '@ofuro/core/components/hooks/affine-async-hooks';
import { type Doc, DocsService } from '@ofuro/core/modules/doc';
import { TemplateDocService } from '@ofuro/core/modules/template-doc';
import { WorkbenchService } from '@ofuro/core/modules/workbench';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import track from '@ofuro/track';
import { EditIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback } from 'react';

import { TabItem } from './tab-item';
import type { AppTabCustomFCProps } from './type';

/** 空のページを探す範囲（新しい順）。全部見ると重い */
const EMPTY_DOC_SCAN_COUNT = 3;

/**
 * 探すのに使ってよい時間の合計（ミリ秒）。
 *
 * ⚠️ **1件ごとではなく合計で切る。** 1件ごとだと、同期が終わらないページが
 * 候補の数だけ並んだとき待ち時間が積み上がり、タブが数秒間無反応になる。
 * ⚠️ **待ち切りにもしない。** 1件でも終わらないと、押しても何も起きなくなる
 * （E2E で実際に踏んだ）。
 */
const EMPTY_DOC_BUDGET_MS = 2000;

/**
 * それ自体では中身と見なさないブロック。
 *
 * ⚠️ **文字だけで判定しないこと。** 画像・添付・埋め込み・データベースは
 * 文字を持たないため、文字だけを見ると「画像1枚のページ」が空と判定され、
 * 新規ドキュメントのタブでそのページが開いてしまう（レビュー指摘）。
 */
const STRUCTURAL_FLAVOURS = new Set([
  'affine:page',
  'affine:note',
  'affine:surface',
  'affine:paragraph',
  'affine:list',
]);

/** ブロック1つ分の見え方（必要な項目だけ） */
interface BlockLike {
  flavour: string;
  text?: { length: number };
  children?: BlockLike[];
}

/**
 * 題も本文も無いか。
 *
 * ⚠️ **ルートから子をたどる。** ブロックの一覧（`blocks.peek()`）は
 * 取り出し方が変わり得るうえ、空と判定された原因の切り分けが難しい。
 */
function isStoreEmpty(root: BlockLike): boolean {
  if (root.text && root.text.length > 0) return false;
  if (!STRUCTURAL_FLAVOURS.has(root.flavour)) return false;
  for (const child of root.children ?? []) {
    if (!isStoreEmpty(child)) return false;
  }
  return true;
}

export const AppTabCreate = ({ tab }: AppTabCustomFCProps) => {
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  const workspaceService = useService(WorkspaceService);
  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);

  const currentWorkspace = workspaceService.workspace;
  const pageHelper = usePageHelper(currentWorkspace.docCollection);
  const enablePageTemplate = useLiveData(
    templateDocService.setting.enablePageTemplate$
  );
  const pageTemplateDocId = useLiveData(
    templateDocService.setting.pageTemplateDocId$
  );

  /**
   * ⚠️ **題も本文も空のページが既にあるなら、それを開く（#105）。**
   *
   * このタブは押すたびに作るため、押した回数だけ空のページが残っていた。
   * 確認を挟むと毎回1手増えるので、増やさない側で直す。
   *
   * ⚠️ 題が空のものだけを、新しい順に少しだけ見る。全部を読みに行くと重い。
   * 本文の判定には中身が要るので、`open` で読み込んでから必ず `release` する。
   * 探すのに使う時間は合計で `EMPTY_DOC_BUDGET_MS` まで。
   */
  const findEmptyDoc = useCallback(async () => {
    const collection = currentWorkspace.docCollection;
    const candidates = [...collection.meta.docMetas]
      .filter(meta => !meta.trash && !(meta.title ?? '').trim())
      // ⚠️ 作りたてのページは updatedDate を持たない。無ければ createDate で並べる。
      // updatedDate だけで並べると、**今作ったページが後ろに回って範囲から外れる**
      .sort(
        (a, b) =>
          (b.updatedDate ?? b.createDate ?? 0) -
          (a.updatedDate ?? a.createDate ?? 0)
      )
      .slice(0, EMPTY_DOC_SCAN_COUNT);

    const deadline = Date.now() + EMPTY_DOC_BUDGET_MS;

    for (const meta of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      let opened: { doc: Doc; release: () => void } | null = null;
      try {
        opened = docsService.open(meta.id);
        await Promise.race([
          opened.doc.waitForSyncReady(),
          new Promise(resolve => setTimeout(resolve, remaining)),
        ]);
        const store = collection.getDoc(meta.id)?.getStore({ id: meta.id });
        if (store?.root && isStoreEmpty(store.root as unknown as BlockLike)) {
          return meta.id;
        }
      } catch {
        // 読めないページは判定しない（消えた・権限が無い等）
      } finally {
        opened?.release();
      }
    }
    return null;
  }, [currentWorkspace, docsService]);

  const createPage = useAsyncCallback(
    async (isActive: boolean) => {
      if (isActive) return;

      const emptyDocId = await findEmptyDoc();
      if (emptyDocId) {
        workbench.openDoc({ docId: emptyDocId, fromTab: 'true' });
        return;
      }

      if (enablePageTemplate && pageTemplateDocId) {
        const docId =
          await docsService.duplicateFromTemplate(pageTemplateDocId);
        workbench.openDoc({ docId, fromTab: 'true' });
      } else {
        const doc = pageHelper.createPage(undefined, { show: false });
        workbench.openDoc({ docId: doc.id, fromTab: 'true' });
      }
      track.$.navigationPanel.$.createDoc();
    },
    [
      docsService,
      enablePageTemplate,
      findEmptyDoc,
      pageHelper,
      pageTemplateDocId,
      workbench,
    ]
  );

  return (
    <TabItem id={tab.key} onClick={createPage} label={t['New Page']()}>
      <EditIcon />
    </TabItem>
  );
};
