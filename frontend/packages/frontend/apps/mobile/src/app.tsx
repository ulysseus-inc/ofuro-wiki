import { AffineContext } from '@ofuro/core/components/context';
import { router } from '@ofuro/core/mobile/router';
import { configureCommonModules } from '@ofuro/core/modules';
import { I18nProvider } from '@ofuro/core/modules/i18n';
import { LifecycleService } from '@ofuro/core/modules/lifecycle';
import {
  configureLocalStorageStateStorageImpls,
  NbstoreProvider,
} from '@ofuro/core/modules/storage';
import { PopupWindowProvider } from '@ofuro/core/modules/url';
import { configureBrowserWorkbenchModule } from '@ofuro/core/modules/workbench';
import { configureBrowserWorkspaceFlavours } from '@ofuro/core/modules/workspace-engine';
import { configureMobileModules } from '@ofuro/core/mobile/modules';
import createEmotionCache from '@ofuro/core/utils/create-emotion-cache';
import { getWorkerUrl } from '@ofuro/env/worker';
import { StoreManagerClient } from '@ofuro/nbstore/worker/client';
import { CacheProvider } from '@emotion/react';
import { Framework, FrameworkRoot, getCurrentStore } from '@toeverything/infra';
import { OpClient } from '@toeverything/infra/op';
import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';

const cache = createEmotionCache();

let storeManagerClient: StoreManagerClient;

const workerUrl = getWorkerUrl('nbstore');

if (
  window.SharedWorker &&
  localStorage.getItem('disableSharedWorker') !== 'true'
) {
  const worker = new SharedWorker(workerUrl, {
    name: 'affine-shared-worker',
  });
  storeManagerClient = new StoreManagerClient(new OpClient(worker.port));
} else {
  const worker = new Worker(workerUrl);
  storeManagerClient = new StoreManagerClient(new OpClient(worker));
}
// ofuro-wiki: telemetry transport disabled
window.addEventListener('beforeunload', () => {
  storeManagerClient.dispose();
});
window.addEventListener('focus', () => {
  storeManagerClient.resume();
});
window.addEventListener('click', () => {
  storeManagerClient.resume();
});
window.addEventListener('blur', () => {
  storeManagerClient.pause();
});

const future = {
  v7_startTransition: true,
} as const;

const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework);
configureMobileModules(framework);
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
framework.impl(NbstoreProvider, {
  openStore(key, options) {
    return storeManagerClient.open(key, options);
  },
});
framework.impl(PopupWindowProvider, {
  open: (target: string) => {
    const targetUrl = new URL(target);

    let url: string;
    // safe to open directly if in the same origin
    if (targetUrl.origin === location.origin) {
      url = target;
    } else {
      const redirectProxy = location.origin + '/redirect-proxy';
      const search = new URLSearchParams({
        redirect_uri: target,
      });

      url = `${redirectProxy}?${search.toString()}`;
    }
    window.open(url, '_blank', 'popup noreferrer noopener');
  },
});
const frameworkProvider = framework.provider();

// setup application lifecycle events, and emit application start event
window.addEventListener('focus', () => {
  frameworkProvider.get(LifecycleService).applicationFocus();
});
frameworkProvider.get(LifecycleService).applicationStart();

export function App() {
  return (
    <Suspense>
      <FrameworkRoot framework={frameworkProvider}>
        <CacheProvider value={cache}>
          <I18nProvider>
            <AffineContext store={getCurrentStore()}>
              <RouterProvider
                fallbackElement={<MobileLoading />}
                router={router}
                future={future}
              />
            </AffineContext>
          </I18nProvider>
        </CacheProvider>
      </FrameworkRoot>
    </Suspense>
  );
}

function MobileLoading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
      }}
    >
      <svg
        width="120"
        height="120"
        viewBox="0 0 40 40"
        style={{ animation: 'spin 1s linear infinite' }}
      >
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="3"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="#1e96eb"
          strokeWidth="3"
          strokeDasharray="80"
          strokeDashoffset="60"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
