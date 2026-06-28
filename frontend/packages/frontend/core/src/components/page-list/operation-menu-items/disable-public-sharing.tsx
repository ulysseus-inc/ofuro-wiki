import type { MenuItemProps } from '@ofuro/component';
import { MenuItem } from '@ofuro/component';
import { useI18n } from '@ofuro/i18n';
import { ShareIcon } from '@blocksuite/icons/rc';

export const DisablePublicSharing = (props: MenuItemProps) => {
  const t = useI18n();
  return (
    <MenuItem type="danger" prefixIcon={<ShareIcon />} {...props}>
      {t['Disable Public Sharing']()}
    </MenuItem>
  );
};
