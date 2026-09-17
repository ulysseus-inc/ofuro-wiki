export { Tag } from './entities/tag';
export {
  affineLabelToDatabaseTagColor,
  databaseTagColorToAffineLabel,
} from './entities/utils';
export { TagService } from './service/tag';
export { useDeleteTagConfirmModal } from './view/delete-tag-modal';

import { type Framework } from '@toeverything/infra';

import { DocsService } from '../doc';
// ⚠️ バレルから読まないこと（stores/tag.ts の注記と同じ理由）
import { DocsStore } from '../doc/stores/docs';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Tag } from './entities/tag';
import { TagList } from './entities/tag-list';
import { TagService } from './service/tag';
import { TagStore } from './stores/tag';

export function configureTagModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(TagService)
    .store(TagStore, [WorkspaceService, DocsStore])
    .entity(TagList, [TagStore, DocsService])
    .entity(Tag, [TagStore, DocsService]);
}
