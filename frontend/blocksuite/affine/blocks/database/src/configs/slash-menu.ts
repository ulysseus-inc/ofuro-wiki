import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import { TelemetryProvider } from '@blocksuite/affine-shared/services';
import { isInsideBlockByFlavour } from '@blocksuite/affine-shared/utils';
import {
  translateGroupStr,
  translateSlashItem,
} from '@blocksuite/affine-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { viewPresets } from '@blocksuite/data-view/view-presets';
import {
  DatabaseKanbanViewIcon,
  DatabaseTableViewIcon,
} from '@blocksuite/icons/lit';

import { insertDatabaseBlockCommand } from '../commands';
import { KanbanViewTooltip, TableViewTooltip } from './tooltips';

export const databaseSlashMenuConfig: SlashMenuConfig = {
  disableWhen: ({ model }) => model.flavour === 'affine:database',
  items: () => {
    const tvT = translateSlashItem('Table View', 'Display items in a table format.');
    const kvT = translateSlashItem('Kanban View', 'Visualize data in a dashboard.');
    return [
      {
        name: tvT.name,
        description: tvT.description,
        searchAlias: ['database'],
        icon: DatabaseTableViewIcon(),
        tooltip: {
          figure: TableViewTooltip,
          caption: 'Table View',
        },
        group: translateGroupStr('7_Database@0'),
        when: ({ model }) =>
          !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
        action: ({ std }) => {
          std.command
            .chain()
            .pipe(getSelectedModelsCommand)
            .pipe(insertDatabaseBlockCommand, {
              viewType: viewPresets.tableViewMeta.type,
              place: 'after',
              removeEmptyLine: true,
            })
            .pipe(({ insertedDatabaseBlockId }) => {
              if (insertedDatabaseBlockId) {
                const telemetry = std.getOptional(TelemetryProvider);
                telemetry?.track('BlockCreated', {
                  blockType: 'affine:database',
                });
              }
            })
            .run();
        },
      },

      {
        name: kvT.name,
        description: kvT.description,
        searchAlias: ['database'],
        icon: DatabaseKanbanViewIcon(),
        tooltip: {
          figure: KanbanViewTooltip,
          caption: 'Kanban View',
        },
        group: translateGroupStr('7_Database@2'),
        when: ({ model }) =>
          !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
        action: ({ std }) => {
          std.command
            .chain()
            .pipe(getSelectedModelsCommand)
            .pipe(insertDatabaseBlockCommand, {
              viewType: viewPresets.kanbanViewMeta.type,
              place: 'after',
              removeEmptyLine: true,
            })
            .pipe(({ insertedDatabaseBlockId }) => {
              if (insertedDatabaseBlockId) {
                const telemetry = std.getOptional(TelemetryProvider);
                telemetry?.track('BlockCreated', {
                  blockType: 'affine:database',
                });
              }
            })
            .run();
        },
      },
    ];
  },
};
