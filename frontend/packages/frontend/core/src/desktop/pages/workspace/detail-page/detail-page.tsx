import { Scrollable } from '@ofuro/component';
import { PageDetailLoading } from '@ofuro/component/page-detail-skeleton';
import type { AffineEditorContainer } from '@ofuro/core/blocksuite/block-suite-editor';
import { EditorOutlineViewer } from '@ofuro/core/blocksuite/outline-viewer';
import { AffineErrorBoundary } from '@ofuro/core/components/affine/affine-error-boundary';
import { GlobalPageHistoryModal } from '@ofuro/core/components/affine/page-history-modal';
import { CommentSidebar } from '@ofuro/core/components/comment/sidebar';
import { useGuard } from '@ofuro/core/components/guard';
import { useAppSettingHelper } from '@ofuro/core/components/hooks/affine/use-app-setting-helper';
import { useRegisterBlocksuiteEditorCommands } from '@ofuro/core/components/hooks/affine/use-register-blocksuite-editor-commands';
import { useActiveBlocksuiteEditor } from '@ofuro/core/components/hooks/use-block-suite-editor';
import { PageDetailEditor } from '@ofuro/core/components/page-detail-editor';
import { WorkspacePropertySidebar } from '@ofuro/core/components/properties/sidebar';
import { TrashPageFooter } from '@ofuro/core/components/pure/trash-page-footer';
import { TopTip } from '@ofuro/core/components/top-tip';
import { ServerService } from '@ofuro/core/modules/cloud';
import { DocService } from '@ofuro/core/modules/doc';
import { EditorService } from '@ofuro/core/modules/editor';
import { FeatureFlagService } from '@ofuro/core/modules/feature-flag';
import { GlobalContextService } from '@ofuro/core/modules/global-context';
import { JournalService } from '@ofuro/core/modules/journal';
import { PeekViewService } from '@ofuro/core/modules/peek-view';
import { RecentDocsService } from '@ofuro/core/modules/quicksearch';
import {
  useIsActiveView,
  ViewBody,
  ViewHeader,
  ViewService,
  ViewSidebarTab,
  WorkbenchService,
} from '@ofuro/core/modules/workbench';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { isNewTabTrigger } from '@ofuro/core/utils';
import { ServerFeature } from '@ofuro/graphql';
import track from '@ofuro/track';
import { DisposableGroup } from '@blocksuite/affine/global/disposable';
import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { focusBlockEnd } from '@blocksuite/affine/shared/commands';
import { getLastNoteBlock } from '@blocksuite/affine/shared/utils';
import {
  CommentIcon,
  ExportIcon,
  FrameIcon,
  PropertyIcon,
  TocIcon,
  TodayIcon,
} from '@blocksuite/icons/rc';
import {
  FrameworkScope,
  LiveData,
  useLiveData,
  useService,
  useServices,
} from '@toeverything/infra';
import clsx from 'clsx';
import { nanoid } from 'nanoid';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageNotFound } from '../../404';
import * as styles from './detail-page.css';
import { DetailPageHeader } from './detail-page-header';
import { DetailPageWrapper } from './detail-page-wrapper';
import { EditorAdapterPanel } from './tabs/adapter';
import { EditorFramePanel } from './tabs/frame';
import { EditorJournalPanel } from './tabs/journal';
import { EditorOutlinePanel } from './tabs/outline';

const DetailPageImpl = memo(function DetailPageImpl() {
  const {
    workbenchService,
    viewService,
    editorService,
    docService,
    workspaceService,
    globalContextService,
  } = useServices({
    WorkbenchService,
    ViewService,
    EditorService,
    DocService,
    WorkspaceService,
    GlobalContextService,
  });
  const workbench = workbenchService.workbench;
  const editor = editorService.editor;
  const view = viewService.view;
  const workspace = workspaceService.workspace;
  const globalContext = globalContextService.globalContext;
  const doc = docService.doc;

  // 接続エラー ステータスバー
  const engineSyncState = useLiveData(
    useMemo(
      () => LiveData.from(workspace.engine.doc.state$, null),
      [workspace]
    )
  );
  const isSyncRetrying = engineSyncState?.syncRetrying ?? false;

  const mode = useLiveData(editor.mode$);

  const isInTrash = useLiveData(doc.meta$.map(meta => meta.trash));
  const editorContainer = useLiveData(editor.editorContainer$);

  const isSideBarOpen = useLiveData(workbench.sidebarOpen$);
  const { appSettings } = useAppSettingHelper();

  const peekView = useService(PeekViewService).peekView;

  const isActiveView = useIsActiveView();
  // TODO(@eyhn): remove jotai here
  const [_, setActiveBlockSuiteEditor] = useActiveBlocksuiteEditor();

  const featureFlagService = useService(FeatureFlagService);
  const enableAdapterPanel = useLiveData(
    featureFlagService.flags.enable_adapter_panel.$
  );

  const serverService = useService(ServerService);
  const serverConfig = useLiveData(serverService.server.config$);

  // comment may not be supported by the server
  const enableComment =
    workspace.flavour !== 'local' &&
    serverConfig.features.includes(ServerFeature.Comment);

  useEffect(() => {
    if (isActiveView) {
      setActiveBlockSuiteEditor(editorContainer);
    }
  }, [editorContainer, isActiveView, setActiveBlockSuiteEditor]);

  useEffect(() => {
    if (isActiveView) {
      globalContext.docId.set(doc.id);
      globalContext.isDoc.set(true);

      return () => {
        globalContext.docId.set(null);
        globalContext.isDoc.set(false);
      };
    }
    return;
  }, [doc, globalContext, isActiveView]);

  useEffect(() => {
    if (isActiveView) {
      globalContext.docMode.set(mode);

      return () => {
        globalContext.docMode.set(null);
      };
    }
    return;
  }, [doc, globalContext, isActiveView, mode]);

  useEffect(() => {
    if (isActiveView) {
      globalContext.isTrashDoc.set(!!isInTrash);

      return () => {
        globalContext.isTrashDoc.set(null);
      };
    }
    return;
  }, [globalContext, isActiveView, isInTrash]);

  useRegisterBlocksuiteEditorCommands(editor, isActiveView);

  const journalService = useService(JournalService);
  const isJournal = !!useLiveData(journalService.journalDate$(doc.id));

  const onLoad = useCallback(
    (editorContainer: AffineEditorContainer) => {
      const std = editorContainer.std;
      const disposable = new DisposableGroup();

      // Check if journal and handle accordingly to set focus on input block.
      if (isJournal) {
        const rafId = requestAnimationFrame(() => {
          try {
            if (!editorContainer.isConnected) return;
            const page = editorContainer.page;
            const note = getLastNoteBlock(page);
            const std = editorContainer.std;
            if (note) {
              const lastBlock = note.lastChild();
              if (lastBlock) {
                const focusBlock = std.view.getBlock(lastBlock.id) ?? undefined;
                std.command.exec(focusBlockEnd, { focusBlock, force: true });
                return;
              }
            }
            std.command.exec(focusBlockEnd, { force: true });
          } catch (error) {
            console.error('Failed to focus journal body', error);
          }
        });
        disposable.add(() => cancelAnimationFrame(rafId));
      }
      if (std) {
        const refNodeSlots = std.getOptional(RefNodeSlotsProvider);
        if (refNodeSlots) {
          disposable.add(
            // the event should not be emitted by AffineReference
            refNodeSlots.docLinkClicked.subscribe(
              ({ pageId, params, openMode, event, host }) => {
                if (host !== editorContainer.host) {
                  return;
                }
                openMode ??=
                  event && isNewTabTrigger(event)
                    ? 'open-in-new-tab'
                    : 'open-in-active-view';

                if (openMode === 'open-in-new-view') {
                  track.doc.editor.toolbar.openInSplitView();
                } else if (openMode === 'open-in-center-peek') {
                  track.doc.editor.toolbar.openInPeekView();
                } else if (openMode === 'open-in-new-tab') {
                  track.doc.editor.toolbar.openInNewTab();
                }

                if (openMode !== 'open-in-center-peek') {
                  const at = (() => {
                    if (openMode === 'open-in-active-view') {
                      return 'active';
                    }
                    // split view is only supported on electron
                    if (openMode === 'open-in-new-view') {
                      return BUILD_CONFIG.isElectron ? 'tail' : 'new-tab';
                    }
                    if (openMode === 'open-in-new-tab') {
                      return 'new-tab';
                    }
                    return 'active';
                  })();
                  workbench.openDoc(
                    {
                      docId: pageId,
                      mode: params?.mode,
                      blockIds: params?.blockIds,
                      elementIds: params?.elementIds,
                      refreshKey: nanoid(),
                    },
                    {
                      at: at,
                      show: true,
                    }
                  );
                } else {
                  peekView
                    .open({
                      docRef: {
                        docId: pageId,
                      },
                      ...params,
                    })
                    .catch(console.error);
                }
              }
            )
          );
        }
      }

      const unbind = editor.bindEditorContainer(
        editorContainer,
        (editorContainer as any).docTitle, // set from proxy
        scrollViewportRef.current
      );

      return () => {
        unbind();
        disposable.dispose();
      };
    },
    [editor, workbench, peekView, isJournal]
  );

  const [hasScrollTop, setHasScrollTop] = useState(false);

  const openOutlinePanel = useCallback(() => {
    workbench.openSidebar();
    view.activeSidebarTab('outline');
  }, [workbench, view]);

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;

    const hasScrollTop = scrollTop > 0;
    setHasScrollTop(hasScrollTop);
  }, []);

  const [dragging, setDragging] = useState(false);

  const canEdit = useGuard('Doc_Update', doc.id);

  const readonly = !canEdit || isInTrash;

  // ルートページブロックが欠落した壊れたドキュメント（インポート直後の Ctrl-Z 等）を
  // 開けるよう自己修復する。編集可能な場合のみ実行（読み取り専用では何もしない）。
  useEffect(() => {
    if (readonly) return;
    doc.ensureRootBlock().catch(err => {
      console.error('Failed to ensure root block for doc', doc.id, err);
    });
  }, [doc, readonly]);

  return (
    <FrameworkScope scope={editor.scope}>
      <ViewHeader>
        <DetailPageHeader
          page={doc.blockSuiteDoc}
          workspace={workspace}
          onDragging={setDragging}
        />
      </ViewHeader>
      <ViewBody>
        <div
          className={styles.mainContainer}
          data-dynamic-top-border={BUILD_CONFIG.isElectron}
          data-has-scroll-top={hasScrollTop}
        >
          {/* Add a key to force rerender when page changed, to avoid error boundary persisting. */}
          <AffineErrorBoundary key={doc.id}>
            <TopTip />
            <Scrollable.Root>
              <Scrollable.Viewport
                onScroll={handleScroll}
                ref={scrollViewportRef}
                data-dragging={dragging}
                className={clsx(
                  'affine-page-viewport',
                  styles.affineDocViewport,
                  styles.editorContainer
                )}
              >
                <PageDetailEditor onLoad={onLoad} readonly={readonly} />
              </Scrollable.Viewport>
              <Scrollable.Scrollbar
                className={clsx({
                  [styles.scrollbar]: !appSettings.clientBorder,
                })}
              />
            </Scrollable.Root>
            <EditorOutlineViewer
              editor={editorContainer?.host ?? null}
              show={mode === 'page' && !isSideBarOpen}
              openOutlinePanel={openOutlinePanel}
            />
          </AffineErrorBoundary>
          {isInTrash ? <TrashPageFooter /> : null}
          {isSyncRetrying ? (
            <div className={styles.syncErrorBar}>
              <span>⚠</span>
              <span>Connection lost. Changes may not be saved.</span>
            </div>
          ) : null}
        </div>
      </ViewBody>

      <ViewSidebarTab tabId="properties" icon={<PropertyIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <WorkspacePropertySidebar />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      <ViewSidebarTab tabId="journal" icon={<TodayIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <EditorJournalPanel />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      <ViewSidebarTab tabId="outline" icon={<TocIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <EditorOutlinePanel editor={editorContainer?.host ?? null} />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      <ViewSidebarTab tabId="frame" icon={<FrameIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <EditorFramePanel editor={editorContainer?.host ?? null} />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      {enableAdapterPanel && (
        <ViewSidebarTab tabId="adapter" icon={<ExportIcon />}>
          <Scrollable.Root className={styles.sidebarScrollArea}>
            <Scrollable.Viewport>
              <EditorAdapterPanel host={editorContainer?.host ?? null} />
            </Scrollable.Viewport>
          </Scrollable.Root>
        </ViewSidebarTab>
      )}

      {workspace.flavour !== 'local' && enableComment && (
        <ViewSidebarTab tabId="comment" icon={<CommentIcon />}>
          <Scrollable.Root className={styles.sidebarScrollArea}>
            <Scrollable.Viewport>
              <CommentSidebar />
            </Scrollable.Viewport>
            <Scrollable.Scrollbar />
          </Scrollable.Root>
        </ViewSidebarTab>
      )}

      <GlobalPageHistoryModal />
    </FrameworkScope>
  );
});

export const Component = () => {
  const params = useParams();
  const recentPages = useService(RecentDocsService);

  useEffect(() => {
    if (params.pageId) {
      const pageId = params.pageId;
      localStorage.setItem('last_page_id', pageId);

      recentPages.addRecentDoc(pageId);
    }
  }, [params, recentPages]);

  const pageId = params.pageId;
  const canAccess = useGuard('Doc_Read', pageId ?? '');

  return pageId ? (
    <DetailPageWrapper
      pageId={pageId}
      canAccess={canAccess}
      skeleton={<PageDetailLoading />}
      notFound={<PageNotFound noPermission />}
    >
      <DetailPageImpl />
    </DetailPageWrapper>
  ) : null;
};
