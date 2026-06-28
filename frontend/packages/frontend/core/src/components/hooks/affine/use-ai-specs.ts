import { useConfirmModal, useLitPortalFactory } from '@ofuro/component';
import { getViewManager } from '@ofuro/core/blocksuite/manager/view';
import { FeatureFlagService } from '@ofuro/core/modules/feature-flag';
import { WorkspaceService } from '@ofuro/core/modules/workspace';
import { useFramework, useLiveData, useServices } from '@toeverything/infra';
import { useMemo } from 'react';

export const useAISpecs = () => {
  const framework = useFramework();
  const confirmModal = useConfirmModal();
  const [reactToLit, _portals] = useLitPortalFactory();

  const { workspaceService, featureFlagService } = useServices({
    WorkspaceService,
    FeatureFlagService,
  });

  const enablePDFEmbedPreview = useLiveData(
    featureFlagService.flags.enable_pdf_embed_preview.$
  );

  const isCloud = workspaceService.workspace.flavour !== 'local';

  const specs = useMemo(() => {
    const manager = getViewManager()
      .config.init()
      .foundation(framework)
      .editorConfig(framework)
      .editorView({
        framework,
        reactToLit,
        confirmModal,
        scope: 'workspace',
      })
      .cloud(framework, isCloud)
      .pdf(enablePDFEmbedPreview, reactToLit)
      .database(framework)
      .linkedDoc(framework)
      .paragraph()
      .mobile(framework)
      .electron(framework)
      .linkPreview(framework)
      .iconPicker(framework)
      .codeBlockPreview(framework).value;

    return manager.get('page');
  }, [
    framework,
    reactToLit,
    enablePDFEmbedPreview,
    isCloud,
    confirmModal,
  ]);

  return specs;
};
