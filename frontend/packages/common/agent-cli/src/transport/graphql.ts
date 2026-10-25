import { CliError } from '../errors';
import { type Auth, HTTP_TIMEOUT_MS } from './auth';

const GRAPHQL_PATH = '/graphql';
const HTTP_UNAUTHORIZED = 401;
const UNAUTHENTICATED = 'UNAUTHENTICATED';

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: { code?: string };
  }>;
}

/** 401 で1回だけサインインし直して再送する GraphQL クライアント */
export class GraphqlClient {
  constructor(
    private readonly serverUrl: string,
    private readonly auth: Auth
  ) {}

  async request<T>(query: string, variables: object): Promise<T> {
    const first = await this.send<T>(
      query,
      variables,
      await this.auth.getToken()
    );
    if (!isUnauthenticated(first)) {
      return unwrap(first);
    }

    const retry = await this.send<T>(
      query,
      variables,
      await this.auth.refresh()
    );
    return unwrap(retry);
  }

  private async send<T>(
    query: string,
    variables: object,
    token: string
  ): Promise<{ status: number; body: GraphqlResponse<T> }> {
    const res = await fetch(`${this.serverUrl}${GRAPHQL_PATH}`, {
      method: 'POST',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    }).catch(() => {
      throw new CliError(`サーバーに接続できない: ${this.serverUrl}`);
    });

    const body = (await res.json().catch(() => ({}))) as GraphqlResponse<T>;
    return { status: res.status, body };
  }
}

function isUnauthenticated(res: {
  status: number;
  body: GraphqlResponse<unknown>;
}): boolean {
  if (res.status === HTTP_UNAUTHORIZED) {
    return true;
  }
  return (res.body.errors ?? []).some(
    e => e.extensions?.code === UNAUTHENTICATED
  );
}

function unwrap<T>(res: { status: number; body: GraphqlResponse<T> }): T {
  const error = res.body.errors?.[0];
  if (error) {
    throw new GraphqlError(error.message, error.extensions?.code);
  }
  if (!res.body.data) {
    throw new CliError(`GraphQL の応答が不正（HTTP ${res.status}）`);
  }
  return res.body.data;
}

/** 呼び出し側で「権限なし」等を文言に直すため、コードを保持する */
export class GraphqlError extends CliError {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}
