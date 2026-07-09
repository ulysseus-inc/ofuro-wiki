import { menu } from '@blocksuite/affine-components/context-menu';
import { translateSlashItem } from '@blocksuite/affine-shared/utils';
import { html } from 'lit/static-html.js';

import { renderUniLit } from '../utils/uni-component/index.js';
import type { Property } from '../view-manager/property.js';

export const inputConfig = (property: Property) => {
  return menu.input({
    prefix: html`
      <div class="affine-database-column-type-menu-icon">
        ${renderUniLit(property.icon)}
      </div>
    `,
    initialValue: property.name$.value,
    placeholder: translateSlashItem('Property name').name,
    onBlur: text => {
      property.nameSet(text);
    },
  });
};
export const typeConfig = (property: Property) => {
  return menu.group({
    items: [
      menu.subMenu({
        name: translateSlashItem('Type').name,
        hide: () => !property.typeCanSet,
        postfix: html` <div
          class="affine-database-column-type-icon"
          style="color: var(--affine-text-secondary-color);gap:4px;font-size: 14px;"
        >
          ${renderUniLit(property.icon)}
          ${translateSlashItem(
            property.view.propertyMetas$.value.find(
              v => v.type === property.type$.value
            )?.config.name ?? ''
          ).name}
        </div>`,
        options: {
          title: {
            text: translateSlashItem('Property type').name,
          },
          items: [
            menu.group({
              items: property.view.propertyMetas$.value.map(config => {
                return menu.action({
                  isSelected: config.type === property.type$.value,
                  name: translateSlashItem(config.config.name).name,
                  prefix: renderUniLit(config.renderer.icon),
                  select: () => {
                    if (property.type$.value === config.type) {
                      return;
                    }
                    property.typeSet?.(config.type);
                  },
                });
              }),
            }),
          ],
        },
      }),
    ],
  });
};
