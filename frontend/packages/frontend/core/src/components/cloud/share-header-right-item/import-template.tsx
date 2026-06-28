import { Button } from '@ofuro/component';
import { useNavigateHelper } from '@ofuro/core/components/hooks/use-navigate-helper';
import { useI18n } from '@ofuro/i18n';

export const ImportTemplateButton = ({
  name,
  snapshotUrl,
}: {
  name: string;
  snapshotUrl: string;
}) => {
  const t = useI18n();
  const { jumpToImportTemplate } = useNavigateHelper();
  return (
    <Button
      variant="primary"
      onClick={() => jumpToImportTemplate(name, snapshotUrl)}
    >
      {t['com.affine.share-page.header.import-template']()}
    </Button>
  );
};
