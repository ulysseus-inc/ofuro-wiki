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
        nav(`/sign-in?error=${encodeURIComponent(e.message)}`);
      });
  }, [data, auth, nav]);

  return null;
};
