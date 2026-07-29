import { useService } from '@toeverything/infra';
import { useEffect, useRef } from 'react';
import {
  type LoaderFunction,
  redirect,
  useLoaderData,
  useNavigate,
} from 'react-router-dom';

import { AuthService } from '../../../modules/cloud';

interface LoaderData {
  state: string;
  code: string;
  provider: string;
}

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const queries = url.searchParams;
  const code = queries.get('code');
  let stateStr = queries.get('state') ?? '{}';

  if (!code || !stateStr) {
    return redirect('/sign-in?error=Invalid oauth callback parameters');
  }

  try {
    const { state, provider } = JSON.parse(stateStr);
    stateStr = state;

    const payload: LoaderData = {
      state,
      code,
      provider,
    };

    return payload;
  } catch {
    return redirect('/sign-in?error=Invalid oauth callback parameters');
  }
};

/** サインイン画面（ポップアップの呼び出し元）へ失敗を伝えるチャンネル */
export const OAUTH_RESULT_CHANNEL = 'ofuro-oauth-result';

function notifyOpenerOfFailure(message: string) {
  try {
    const channel = new BroadcastChannel(OAUTH_RESULT_CHANNEL);
    channel.postMessage({ type: 'error', message });
    channel.close();
  } catch {
    // 未対応環境では、下のフォールバック（この窓に表示）に任せる
  }
}

export const Component = () => {
  const auth = useService(AuthService);
  const data = useLoaderData() as LoaderData;

  // loader data from useLoaderData is not reactive, so that we can safely
  // assume the effect below is only triggered once
  const triggeredRef = useRef(false);

  const nav = useNavigate();

  useEffect(() => {
    if (triggeredRef.current) {
      return;
    }
    triggeredRef.current = true;
    auth
      .signInOauth(data.code, data.state, data.provider)
      .then(() => {
        window.close();
      })
      .catch(e => {
        // ⚠️ 失敗したときにこのウィンドウを残さない。
        // ここはサインイン用に開かれたポップアップなので、そのまま
        // サインイン画面を表示すると「SSO ボタンのある窓」が増えていき、
        // 押すたびにさらに増える（利用者からは何が起きたか分からない）。
        //
        // ポップアップは `noopener` 付きで開かれるため `window.opener` は
        // 使えない。元の画面には BroadcastChannel で伝えて、この窓は閉じる。
        notifyOpenerOfFailure(e.message);
        window.close();

        // ⚠️ `window.close()` の直後に遷移してはいけない。
        // close は即座には反映されないため、そのまま呼ぶと**必ず**遷移が走り、
        // 呼び出し元とこの窓の両方にエラーが出る（二重表示）。
        // 閉じられなかったときだけ表示されるよう、少し待ってから遷移する。
        setTimeout(() => {
          nav(`/sign-in?error=${encodeURIComponent(e.message)}`);
        }, 500);
      });
  }, [data, auth, nav]);

  return null;
};
