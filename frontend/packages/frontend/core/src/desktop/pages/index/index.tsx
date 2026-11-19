import { GraphQLService } from '@ofuro/core/modules/cloud';
import { DesktopApiService } from '@ofuro/core/modules/desktop-api';
import { WorkspacesService } from '@ofuro/core/modules/workspace';
import { buildShowcaseWorkspace } from '@ofuro/core/utils/first-app-data';
import { myPrivateWorkspaceIdQuery } from '@ofuro/graphql';
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
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';
import { AuthService } from '../../../modules/cloud';
import { AppContainer } from '../../components/app-container';

/** 自分のプライベートの問い合わせに失敗した印 */
const FAILED = 'failed' as const;

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

  // #297: 自分のプライベートの ID（docs/workspace-model.md 12.3.1）。
  // undefined = 問い合わせ中、null = 無い（作る）、FAILED = 問い合わせに失敗（以前の判定に戻す）。
  // 共有に入っていてもプライベートが無ければ作るため、一覧の件数では決めない
  const graphqlService = useService(GraphQLService);
  const [privateId, setPrivateId] = useState<string | null | typeof FAILED>();
  // ⚠️ 一覧が変わるたびに問い合わせ直す。作成の途中で一覧に新しいワークスペースが現れたら、
  // そこへ 1 回だけ移動する流れ（#262）を保つため
  const listKey = list.map(w => w.id).join(',');
  useEffect(() => {
    if (!loggedIn || listIsLoading) {
      return;
    }
    let cancelled = false;
    graphqlService
      .gql({ query: myPrivateWorkspaceIdQuery })
      .then(r => {
        if (!cancelled) {
          setPrivateId(r.myPrivateWorkspaceId ?? null);
        }
      })
      .catch(err => {
        console.error('Failed to get the private workspace', err);
        if (!cancelled) {
          setPrivateId(FAILED);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [graphqlService, loggedIn, listIsLoading, listKey]);

  const createCloudWorkspace = useCallback(() => {
    if (createOnceRef.current) return;
    createOnceRef.current = true;
    buildShowcaseWorkspace(workspacesService, 'ofuro-cloud', 'ofuro-wiki')
      .then(({ meta, defaultDocId }) => {
        // #262: 取り込みの途中で、一覧の更新を受けてすでに移動していたら何もしない。
        // もう一度移動すると、その間に利用者が開いたページから一覧へ戻してしまう
        // （docs/first-workspace.md）
        if (navigatedRef.current) {
          return;
        }
        navigatedRef.current = true;

        if (defaultDocId) {
          jumpToPage(meta.id, defaultDocId);
        } else {
          openPage(meta.id, defaultIndexRoute);
        }
      })
      .catch(err => {
        // #297: 次に一覧が変わったとき作り直せるようにする（12.3.1）
        createOnceRef.current = false;
        console.error('Failed to create cloud workspace', err);
      });
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

    // #297: 自分のプライベートが分かるまで待つ
    if (privateId === undefined) {
      return;
    }
    const hasPrivate =
      privateId === FAILED ? list.length > 0 : privateId !== null;
    if (searchParams.get('initCloud') === 'true') {
      if (list.every(w => w.flavour !== 'ofuro-cloud')) {
        createCloudWorkspace();
        return;
      }

      // open first cloud workspace
      const openWorkspace =
        list.find(w => w.flavour === 'ofuro-cloud') ?? list[0];
      openPage(openWorkspace.id, defaultIndexRoute);
    } else {
      if (!hasPrivate) {
        // #297: 自分のプライベートが無ければ作る（共有に入っていても）
        createCloudWorkspace();
        return;
      }
      // open last workspace（マニュアルWSを明示的に開いていた場合はそのまま尊重）
      const lastId = localStorage.getItem('last_workspace_id');

      const openWorkspace =
        list.find(w => w.id === lastId) ??
        list.find(w => w.id === privateId) ??
        list[0];
      // #297: プライベートはあるが一覧にまだ無い（別のタブで作った直後など）。一覧の更新を待つ
      if (!openWorkspace) {
        return;
      }
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
    privateId,
  ]);

  const desktopApi = useServiceOptional(DesktopApiService);

  useEffect(() => {
    desktopApi?.handler.ui.pingAppLayoutReady().catch(console.error);
  }, [desktopApi]);

  return fallback ?? children ?? <AppContainer fallback />;
};
