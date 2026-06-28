// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import 'katex/dist/katex.min.css';

import { useConfirmModal, useLitPortalFactory } from '@ofuro/component';
import {
  type EdgelessEditor,
  LitDocEditor,
  LitDocTitle,
  LitEdgelessEditor,
  type PageEditor,
} from '@ofuro/core/blocksuite/editors';
import { getViewManager } from '@ofuro/core/blocksuite/manager/view';
import { useEnableAI } from '@ofuro/core/components/hooks/affine/use-enable-ai';
import { ServerService } from '@ofuro/core/modules/cloud';
import type { DocCustomPropertyInfo } from '@ofuro/core/modules/db';
import type {
  DatabaseRow,
  DatabaseValueCell,
} from '@ofuro/core/modules/doc-info/types';
import { EditorSettingService } from '@ofuro/core/modules/editor-setting';
import { ExplorerIconService } from '@ofuro/core/modules/explorer-icon/services/explorer-icon';
import { FeatureFlagService } from '@ofuro/core/modules/feature-flag';
import { JournalService } from '@ofuro/core/modules/journal';
import { useInsidePeekView } from '@ofuro/core/modules/peek-view';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { ServerFeature } from '@ofuro/graphql';
import track from '@ofuro/track';
import type { DocTitle } from '@blocksuite/affine/fragments/doc-title';
import type { DocMode } from '@blocksuite/affine/model';
import type { Store } from '@blocksuite/affine/store';
import {
  useFramework,
  useLiveData,
  useService,
  useServices,
} from '@toeverything/infra';
import type React from 'react';
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import {
  type DefaultOpenProperty,
  WorkspacePropertiesTable,
} from '../../components/properties';
import { BiDirectionalLinkPanel } from './bi-directional-link-panel';
import { DocIconPicker } from './doc-icon-picker';
import { BlocksuiteEditorJournalDocTitle } from './journal-doc-title';
import { StarterBar } from './starter-bar';
import * as styles from './styles.css';

interface BlocksuiteEditorProps {
  page: Store;
  readonly?: boolean;
  shared?: boolean;
  defaultOpenProperty?: DefaultOpenProperty;
}

const usePatchSpecs = (mode: DocMode, shared?: boolean) => {
  const [reactToLit, portals] = useLitPortalFactory();
  const { workspaceService, featureFlagService } = useServices({
    WorkspaceService,
    FeatureFlagService,
  });
  const isCloud = workspaceService.workspace.flavour !== 'local';
  const framework = useFramework();

  const confirmModal = useConfirmModal();

  const enableAI = useEnableAI();

  const isInPeekView = useInsidePeekView();

  const enableTurboRenderer = useLiveData(
    featureFlagService.flags.enable_turbo_renderer.$
  );

  const enablePDFEmbedPreview = useLiveData(
    featureFlagService.flags.enable_pdf_embed_preview.$
  );

  const serverService = useService(ServerService);
  const serverConfig = useLiveData(serverService.server.config$);

  // comment may not be supported by the server
  const enableComment =
    isCloud && serverConfig.features.includes(ServerFeature.Comment) && !shared;

  const patchedSpecs = useMemo(() => {
    const manager = getViewManager()
      .config.init()
      .foundation(framework)
      .theme(framework)
      .editorConfig(framework)
      .editorView({
        framework,
        reactToLit,
        confirmModal,
      })
      .cloud(framework, isCloud)
      .turboRenderer(enableTurboRenderer)
      .pdf(enablePDFEmbedPreview, reactToLit)
      .edgelessBlockHeader({
        framework,
        isInPeekView,
        reactToLit,
      })
      .database(framework)
      .linkedDoc(framework)
      .paragraph()
      .mobile(framework)
      .electron(framework)
      .linkPreview(framework)
      .codeBlockPreview(framework)
      .iconPicker(framework)
      .comment(enableComment, framework).value;

    if (BUILD_CONFIG.isMobileEdition) {
      if (mode === 'page') {
        return manager.get('mobile-page');
      } else {
        return manager.get('mobile-edgeless');
      }
    } else {
      return manager.get(mode);
    }
  }, [
    confirmModal,
    enableAI,
    enablePDFEmbedPreview,
    enableTurboRenderer,
    enableComment,
    framework,
    isInPeekView,
    isCloud,
    mode,
    reactToLit,
  ]);

  return [
    patchedSpecs,
    useMemo(
      () => (
        <>
          {portals.map(p => (
            <Fragment key={p.id}>{p.portal}</Fragment>
          ))}
        </>
      ),
      [portals]
    ),
  ] as const;
};

export const BlocksuiteDocEditor = forwardRef<
  PageEditor,
  BlocksuiteEditorProps & {
    onClickBlank?: () => void;
    titleRef?: React.Ref<DocTitle>;
  }
>(function BlocksuiteDocEditor(
  {
    page,
    shared,
    onClickBlank,
    titleRef: externalTitleRef,
    defaultOpenProperty,
    readonly,
  },
  ref
) {
  const titleRef = useRef<DocTitle | null>(null);
  const docRef = useRef<PageEditor | null>(null);
  const journalService = useService(JournalService);
  const isJournal = !!useLiveData(journalService.journalDate$(page.id));

  const editorSettingService = useService(EditorSettingService);
  const explorerIconService = useService(ExplorerIconService);
  const docIcon = useLiveData(explorerIconService.icon$('doc', page.id));
  const hasDocIcon = !!docIcon?.icon;

  const onDocRef = useCallback(
    (el: PageEditor) => {
      docRef.current = el;
      if (ref) {
        if (typeof ref === 'function') {
          ref(el);
        } else {
          ref.current = el;
        }
      }
    },
    [ref]
  );

  const onTitleRef = useCallback(
    (el: DocTitle) => {
      titleRef.current = el;
      if (externalTitleRef) {
        if (typeof externalTitleRef === 'function') {
          externalTitleRef(el);
        } else {
          externalTitleRef.current = el;
        }
      }
    },
    [externalTitleRef]
  );

  const [specs, portals] = usePatchSpecs('page', shared);

  const displayBiDirectionalLink = useLiveData(
    editorSettingService.editorSetting.settings$.selector(
      s => s.displayBiDirectionalLink
    )
  );

  const displayDocInfo = useLiveData(
    editorSettingService.editorSetting.settings$.selector(s => s.displayDocInfo)
  );

  const onPropertyChange = useCallback((property: DocCustomPropertyInfo) => {
    track.doc.inlineDocInfo.property.editProperty({
      type: property.type,
    });
  }, []);

  const onPropertyAdded = useCallback((property: DocCustomPropertyInfo) => {
    track.doc.inlineDocInfo.property.addProperty({
      type: property.type,
      control: 'at menu',
    });
  }, []);

  const onDatabasePropertyChange = useCallback(
    (_row: DatabaseRow, cell: DatabaseValueCell) => {
      track.doc.inlineDocInfo.databaseProperty.editProperty({
        type: cell.property.type$.value,
      });
    },
    []
  );

  const onPropertyInfoChange = useCallback(
    (property: DocCustomPropertyInfo, field: string) => {
      track.doc.inlineDocInfo.property.editPropertyMeta({
        type: property.type,
        field,
      });
    },
    []
  );

  return (
    <>
      <div className={styles.affineDocViewport}>
        <div className={hasDocIcon ? styles.docTitleWithIcon : undefined}>
          {!BUILD_CONFIG.isMobileEdition ? (
            <DocIconPicker docId={page.id} readonly={readonly || shared} />
          ) : null}
          {!isJournal ? (
            <LitDocTitle doc={page} ref={onTitleRef} />
          ) : (
            <BlocksuiteEditorJournalDocTitle page={page} />
          )}
        </div>
        {!shared && displayDocInfo ? (
          <div className={styles.docPropertiesTableContainer}>
            <WorkspacePropertiesTable
              className={styles.docPropertiesTable}
              onDatabasePropertyChange={onDatabasePropertyChange}
              onPropertyChange={onPropertyChange}
              onPropertyAdded={onPropertyAdded}
              onPropertyInfoChange={onPropertyInfoChange}
              defaultOpenProperty={defaultOpenProperty}
            />
          </div>
        ) : null}
        <LitDocEditor
          className={styles.docContainer}
          ref={onDocRef}
          doc={page}
          specs={specs}
        />
        <div
          className={styles.docEditorGap}
          data-testid="page-editor-blank"
          onClick={onClickBlank}
        ></div>
        {!readonly && !BUILD_CONFIG.isMobileEdition && (
          <StarterBar doc={page} />
        )}
        {!shared && displayBiDirectionalLink ? (
          <BiDirectionalLinkPanel />
        ) : null}
      </div>
      {portals}
    </>
  );
});
export const BlocksuiteEdgelessEditor = forwardRef<
  EdgelessEditor,
  BlocksuiteEditorProps
>(function BlocksuiteEdgelessEditor({ page }, ref) {
  const [specs, portals] = usePatchSpecs('edgeless');
  const editorRef = useRef<EdgelessEditor | null>(null);

  const onDocRef = useCallback(
    (el: EdgelessEditor) => {
      editorRef.current = el;
      if (ref) {
        if (typeof ref === 'function') {
          ref(el);
        } else {
          ref.current = el;
        }
      }
    },
    [ref]
  );

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateComplete
        .then(() => {
          // make sure editor can get keyboard events on showing up
          editorRef.current
            ?.querySelector<HTMLElement>('affine-edgeless-root')
            ?.click();
        })
        .catch(console.error);
    }
  }, []);

  return (
    <div className={styles.affineEdgelessDocViewport}>
      <LitEdgelessEditor ref={onDocRef} doc={page} specs={specs} />
      {portals}
    </div>
  );
});
