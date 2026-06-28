import { IconButton } from '@ofuro/component';
import { EditorService } from '@ofuro/core/modules/editor';
import { PresentationIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';

export const DetailPageHeaderPresentButton = () => {
  const editorService = useService(EditorService);

  return (
    <IconButton
      style={{ flexShrink: 0 }}
      size="24"
      onClick={() => editorService.editor.togglePresentation()}
    >
      <PresentationIcon />
    </IconButton>
  );
};
