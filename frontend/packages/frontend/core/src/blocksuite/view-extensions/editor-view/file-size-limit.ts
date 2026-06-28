import { WorkspaceDialogService } from '@ofuro/core/modules/dialogs';
import track from '@ofuro/track';
import type { Container } from '@blocksuite/affine/global/di';
import {
  FileSizeLimitProvider,
  type IFileSizeLimitService,
} from '@blocksuite/affine/shared/services';
import { Extension } from '@blocksuite/affine/store';
import type { FrameworkProvider } from '@toeverything/infra';

export function patchFileSizeLimitExtension(framework: FrameworkProvider) {
  const workspaceDialogService = framework.get(WorkspaceDialogService);

  class AffineFileSizeLimitService
    extends Extension
    implements IFileSizeLimitService
  {
    // 2GB
    maxFileSize = 2 * 1024 * 1024 * 1024;

    // ofuro-wiki: no plan upsell, just log
    onOverFileSize() {
      console.warn('File exceeds the 2GB size limit');
    }

    static override setup(di: Container) {
      di.override(FileSizeLimitProvider, AffineFileSizeLimitService);
    }
  }

  return AffineFileSizeLimitService;
}
