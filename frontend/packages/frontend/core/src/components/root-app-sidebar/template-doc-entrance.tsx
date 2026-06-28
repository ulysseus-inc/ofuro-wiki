import { Menu, MenuSeparator } from '@ofuro/component';
import { MenuItem as SidebarMenuItem } from '@ofuro/core/modules/app-sidebar/views';
import {
  TemplateListMenuAdd,
  TemplateListMenuContentScrollable,
} from '@ofuro/core/modules/template-doc/view/template-list-menu';
import { useI18n } from '@ofuro/i18n';
import track from '@ofuro/track';
import { TemplateIcon } from '@blocksuite/icons/rc';
import { useCallback, useState } from 'react';

export const TemplateDocEntrance = () => {
  const t = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setMenuOpen(prev => !prev);
  }, []);

  const onMenuOpenChange = useCallback((open: boolean) => {
    if (open) track.$.sidebar.template.openTemplateListMenu();
    setMenuOpen(open);
  }, []);

  return (
    <SidebarMenuItem
      data-testid="sidebar-template-doc-entrance"
      icon={<TemplateIcon />}
      onClick={toggleMenu}
    >
      <Menu
        rootOptions={{ open: menuOpen, onOpenChange: onMenuOpenChange }}
        contentOptions={{
          side: 'right',
          align: 'end',
          alignOffset: -4,
          sideOffset: 16,
          style: { width: 280 },
        }}
        items={
          <TemplateListMenuContentScrollable
            asLink
            suffixItems={
              <>
                <MenuSeparator />
                <TemplateListMenuAdd />
              </>
            }
          />
        }
      >
        <span>{t['Template']()}</span>
      </Menu>
    </SidebarMenuItem>
  );
};
