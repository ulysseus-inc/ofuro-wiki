import { wrapCreateBrowserRouterV6 } from '@sentry/react';
import type { RouteObject } from 'react-router-dom';
import {
  createBrowserRouter as reactRouterCreateBrowserRouter,
  redirect,
  useNavigate,
} from 'react-router-dom';

import { AffineErrorComponent } from '../components/affine/affine-error-boundary/affine-error-fallback';
import { NavigateContext } from '../components/hooks/use-navigate-helper';
import { RootWrapper } from './pages/root';

export function RootRouter() {
  const navigate = useNavigate();

  return (
    <NavigateContext.Provider value={navigate}>
      <RootWrapper />
    </NavigateContext.Provider>
  );
}

export const topLevelRoutes = [
  {
    element: <RootRouter />,
    errorElement: <AffineErrorComponent />,
    children: [
      {
        path: '/',
        lazy: () => import('./pages/index'),
      },
      {
        path: '/workspace/:workspaceId/*',
        lazy: () => import('./pages/workspace/index'),
      },
      {
        path: '/share/:workspaceId/:pageId',
        loader: ({ params }) => {
          return redirect(`/workspace/${params.workspaceId}/${params.pageId}`);
        },
      },
      {
        path: '/terms',
        lazy: () => import('./pages/terms'),
      },
      {
        path: '/404',
        lazy: () => import('./pages/404'),
      },
      {
        path: '/expired',
        lazy: () => import('./pages/expired'),
      },
      {
        path: '/invite/:inviteId',
        lazy: () => import('./pages/invite'),
      },
      {
        path: '/onboarding',
        lazy: () => import('./pages/onboarding'),
      },
      {
        path: '/redirect-proxy',
        lazy: () => import('./pages/redirect'),
      },
      {
        path: '/try-cloud',
        loader: () => {
          return redirect(
            `/sign-in?redirect_uri=${encodeURIComponent('/?initCloud=true')}`
          );
        },
      },
      {
        path: '/template/import',
        lazy: () => import('./pages/import-template'),
      },
      {
        path: '/template/preview',
        loader: ({ request }) => {
          const url = new URL(request.url);
          const workspaceId = url.searchParams.get('workspaceId');
          const docId = url.searchParams.get('docId');
          const templateName = url.searchParams.get('name');
          const templateMode = url.searchParams.get('mode');
          const snapshotUrl = url.searchParams.get('snapshotUrl');

          return redirect(
            `/workspace/${workspaceId}/${docId}?${new URLSearchParams({
              isTemplate: 'true',
              templateName: templateName ?? '',
              snapshotUrl: snapshotUrl ?? '',
              mode: templateMode ?? 'page',
            }).toString()}`
          );
        },
      },
      {
        path: '/auth/:authType',
        lazy: () => import(/* webpackChunkName: "auth" */ './pages/auth/auth'),
      },
      {
        path: '/sign-In',
        lazy: () =>
          import(/* webpackChunkName: "auth" */ './pages/auth/sign-in'),
      },
      {
        path: '/magic-link',
        lazy: () =>
          import(/* webpackChunkName: "auth" */ './pages/auth/magic-link'),
      },
      {
        path: '/oauth/login',
        lazy: () =>
          import(/* webpackChunkName: "auth" */ './pages/auth/oauth-login'),
      },
      {
        path: '/oauth/callback',
        lazy: () =>
          import(/* webpackChunkName: "auth" */ './pages/auth/oauth-callback'),
      },
      {
        path: '*',
        lazy: () => import('./pages/404'),
      },
    ],
  },
] satisfies [RouteObject, ...RouteObject[]];

const createBrowserRouter = wrapCreateBrowserRouterV6(
  reactRouterCreateBrowserRouter
);
export const router = (
  window.SENTRY_RELEASE ? createBrowserRouter : reactRouterCreateBrowserRouter
)(topLevelRoutes, {
  basename: environment.subPath,
  future: {
    v7_normalizeFormMethod: true,
  },
});
