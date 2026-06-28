import { DesktopApiService } from '@ofuro/core/modules/desktop-api';
import {
  CacheStorage,
  GlobalCache,
  GlobalState,
} from '@ofuro/core/modules/storage';
import {
  ElectronGlobalCache,
  ElectronGlobalState,
} from '@ofuro/core/modules/storage/impls/electron';
import { IDBGlobalState } from '@ofuro/core/modules/storage/impls/storage';
import type { Framework } from '@toeverything/infra';

export function configureElectronStateStorageImpls(framework: Framework) {
  framework.impl(GlobalCache, ElectronGlobalCache, [DesktopApiService]);
  framework.impl(GlobalState, ElectronGlobalState, [DesktopApiService]);
  framework.impl(CacheStorage, IDBGlobalState);
}
