import { DesktopApiService } from '@ofuro/core/modules/desktop-api';
import { WorkspacesService } from '@ofuro/core/modules/workspace';
import { buildShowcaseWorkspace } from '@ofuro/core/utils/first-app-data';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';
import { AuthService } from '../../../modules/cloud';
import { AppContainer } from '../../components/app-container';

/**
 * index page
 *
 * query string:
 * - initCloud: boolean, if true, when user is logged in, create a cloud workspace
 */
export const Component = ({
  defaultIndexRoute = 'all',
  children,
  fallback,
}: {
  defaultIndexRoute?: string;
  children?: ReactNode;
  fallback?: ReactNode;
}) => {
  const navigatedRef = useRef(false);
  const authService = useService(AuthService);

  const loggedIn = useLiveData(
    authService.session.status$.map(s => s === 'authenticated')
  );

  const workspacesService = useService(WorkspacesService);
  const list = useLiveData(workspacesService.list.workspaces$);
  const listIsLoading = useLiveData(workspacesService.list.isRevalidating$);

  const { openPage, jumpToPage, jumpToSignIn } = useNavigateHelper();
  const [searchParams] = useSearchParams();

  const createOnceRef = useRef(false);

  // #72 マニュアル専用WS（読み取り専用・全ユーザー自動参加）は「自分のワークスペース」
  // として数えない。これが list に居ても、自分のWSが無ければ自動作成し、
  // 既定の遷移先にもマニュアルWSを選ばない（Reader のため編集不可で詰むのを防ぐ）。
  const isManualWorkspace = (id: string) =>
    id.startsWith('ffffffff-ffff-4fff');

  const createCloudWorkspace = useCallback(() => {
    if (createOnceRef.current) return;
    createOnceRef.current = true;
    buildShowcaseWorkspace(workspacesService, 'ofuro-cloud', 'ofuro-wiki')
      .then(({ meta, defaultDocId }) => {
        if (defaultDocId) {
          jumpToPage(meta.id, defaultDocId);
        } else {
          openPage(meta.id, defaultIndexRoute);
        }
      })
      .catch(err => console.error('Failed to create cloud workspace', err));
  }, [defaultIndexRoute, jumpToPage, openPage, workspacesService]);

  useLayoutEffect(() => {
    if (navigatedRef.current) {
      return;
    }

    if (listIsLoading) {
      return;
    }

    if (!loggedIn) {
      localStorage.removeItem('last_workspace_id');
      jumpToSignIn();
      return;
    }

    // check is user logged in && has cloud workspace
    const ownList = list.filter(w => !isManualWorkspace(w.id));
    if (searchParams.get('initCloud') === 'true') {
      if (ownList.every(w => w.flavour !== 'ofuro-cloud')) {
        createCloudWorkspace();
        return;
      }

      // open first cloud workspace
      const openWorkspace =
        ownList.find(w => w.flavour === 'ofuro-cloud') ?? ownList[0];
      openPage(openWorkspace.id, defaultIndexRoute);
    } else {
      if (ownList.length === 0) {
        // Auto-create cloud workspace for logged-in users with no workspaces
        createCloudWorkspace();
        return;
      }
      // open last workspace（マニュアルWSを明示的に開いていた場合はそのまま尊重）
      const lastId = localStorage.getItem('last_workspace_id');

      const openWorkspace = list.find(w => w.id === lastId) ?? ownList[0];
      openPage(openWorkspace.id, defaultIndexRoute, RouteLogic.REPLACE);
    }
    navigatedRef.current = true;
  }, [
    createCloudWorkspace,
    list,
    openPage,
    searchParams,
    jumpToSignIn,
    listIsLoading,
    loggedIn,
    defaultIndexRoute,
  ]);

  const desktopApi = useServiceOptional(DesktopApiService);

  useEffect(() => {
    desktopApi?.handler.ui.pingAppLayoutReady().catch(console.error);
  }, [desktopApi]);

  return fallback ?? children ?? <AppContainer fallback />;
};
