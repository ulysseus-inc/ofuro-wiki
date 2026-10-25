import { workspaceName } from '../convert/workspace-meta';
import { CliError, notFound } from '../errors';
import { Auth } from '../transport/auth';
import {
  type Config,
  CONFIG_FILE,
  ConfigSource,
  loadConfig,
  parsePageRef,
  parseServerUrl,
  saveConfig,
} from '../transport/config';
import { BlobClient } from '../transport/blob';
import { GraphqlClient } from '../transport/graphql';
import { MAX_ASSET_BYTES } from './assets';
import { JoinResult, SyncClient } from '../transport/sync';
import { Space } from './space';

const WORKSPACES_QUERY = `query { workspaces { id name } }`;

/** 名前が重なったときに ID の頭で選べる長さ */
const MIN_ID_PREFIX = 8;

/**
 * 1回のコマンド実行で使う接続一式。
 *
 * ```
 * Session ─┬─ Space（ワークスペースごと）── Ledger ── GraphqlClient ─┐
 *          └─ SyncClient（1本で全ワークスペースに参加）─────────────┴─ Auth（JWT）
 * ```
 *
 * ワークスペースは設定に持たず、サインイン後に知る（設計書 §4.2）。
 */
export class Session {
  private readonly auth: Auth;
  private readonly graphql: GraphqlClient;
  private readonly blobs: BlobClient;
  private sync: SyncClient | null = null;
  private readonly joined = new Set<string>();
  private spaceList: Promise<Space[]> | null = null;

  private constructor(
    readonly config: Config,
    private readonly selector?: string
  ) {
    this.auth = new Auth(config);
    this.graphql = new GraphqlClient(config.serverUrl, this.auth);
    this.blobs = new BlobClient(config.serverUrl, this.auth, MAX_ASSET_BYTES);
  }

  /** `selector` は `--workspace`。無ければ旧形式の URL に含まれていたワークスペース */
  static open(urlOverride?: string, selector?: string): Session {
    const config = loadConfig(urlOverride);
    return new Session(config, selector ?? config.workspace);
  }

  /** 読めない URL なら例外。サーバー部分の URL を返す */
  static serverOf(url: string): string {
    return parseServerUrl(url, ConfigSource.Override).serverUrl;
  }

  /**
   * `ofuro login` の結果を保存する。保存先を返す。
   *
   * ⚠️ パスワードは保存しない。トークンは verifyLogin のサインインで保存済み
   */
  static saveLogin(login: { url: string; email: string }): string {
    saveConfig({ url: login.url, email: login.email });
    return CONFIG_FILE;
  }

  /**
   * 入力されたログイン情報で実際に sign-in し、招待されたワークスペースを返す。
   * 1つも無ければ例外（別アカウントの誤作成を疑う）。
   */
  static async verifyLogin(login: {
    url: string;
    email: string;
    password: string;
  }): Promise<Space[]> {
    const session = new Session({
      serverUrl: Session.serverOf(login.url),
      email: login.email,
      password: login.password,
      source: ConfigSource.Override,
    });
    try {
      await session.auth.refresh();
      return await session.withNames(await session.invited());
    } finally {
      session.close();
    }
  }

  // ─── ワークスペースの決め方（設計書 §4.2） ───────────────

  /** 入れるワークスペース全部（マニュアルを含む） */
  spaces(): Promise<Space[]> {
    this.spaceList ??= this.loadSpaces();
    return this.spaceList;
  }

  /** `list` / `search` の対象。指定が無ければ、招待されたワークスペース全部 */
  async scope(): Promise<Space[]> {
    if (this.selector) {
      return [await this.match(this.selector)];
    }
    return this.invited();
  }

  /** `create` の作成先。指定が無く、候補が2つ以上なら選ばせる */
  async createTarget(): Promise<Space> {
    if (this.selector) {
      return this.match(this.selector);
    }
    const invited = await this.invited();
    if (invited.length === 1) {
      return invited[0];
    }
    await this.withNames(invited);
    throw new CliError(
      `作成先のワークスペースを --workspace で指定する（候補: ${invited.map(s => s.name).join(' / ')}）`,
      '利用者にどのワークスペースに作るか聞き、--workspace <名前> を付けて再実行する'
    );
  }

  /**
   * ページの指定から、ワークスペースと docId を決める。
   *
   * ページ URL ならその中の ID。docId だけなら、各ワークスペースの台帳から探す。
   */
  async resolveDoc(ref: string): Promise<{ space: Space; docId: string }> {
    const spaces = await this.spaces();
    const parsed = parsePageRef(ref);
    if (parsed.workspaceId) {
      const space = spaces.find(s => s.id === parsed.workspaceId);
      if (!space) {
        throw notFound(ref);
      }
      return { space, docId: parsed.docId };
    }

    // `<ws>/<docId>` の形。`/` を含む docId もありうるため、先頭が入れる ID のときだけ
    const slash = ref.indexOf('/');
    const prefixed =
      slash > 0 ? spaces.find(s => s.id === ref.slice(0, slash)) : undefined;
    if (prefixed) {
      return { space: prefixed, docId: ref.slice(slash + 1) };
    }

    const candidates = this.selector
      ? [await this.match(this.selector)]
      : spaces;
    const found: Space[] = [];
    for (const space of candidates) {
      const docs = await space.ledger.documents();
      if (docs.some(d => d.id === ref)) {
        found.push(space);
      }
    }
    if (found.length === 0) {
      throw notFound(ref);
    }
    if (found.length > 1) {
      await this.withNames(found);
      throw new CliError(
        `複数のワークスペースに同じ docId がある: ${ref}（${found.map(s => s.name).join(' / ')}）`,
        '--workspace <名前> を付けるか、ページ URL で指定する'
      );
    }
    return { space: found[0], docId: ref };
  }

  /** 招待されたワークスペース（マニュアルを除く）。無ければ例外 */
  private async invited(): Promise<Space[]> {
    const invited = (await this.spaces()).filter(s => !s.manual);
    if (invited.length > 0) {
      return invited;
    }
    throw new CliError(
      'どのワークスペースにも招待されていない',
      'メールアドレスが正しいか（打ち間違いで別アカウントができていないか）確かめ、管理者に招待してもらう'
    );
  }

  /** `--workspace` の値（ID・名前・ID の頭）で選ぶ */
  private async match(selector: string): Promise<Space> {
    const spaces = await this.spaces();
    const byId = spaces.find(s => s.id === selector);
    if (byId) {
      return byId;
    }
    await this.withNames(spaces);

    const byName = spaces.filter(s => s.name === selector);
    if (byName.length === 1) {
      return byName[0];
    }
    if (byName.length > 1) {
      throw new CliError(
        `同じ名前のワークスペースが複数ある: ${selector}`,
        `ID で指定する（${byName.map(s => s.id).join(' / ')}）`
      );
    }

    const byPrefix =
      selector.length >= MIN_ID_PREFIX
        ? spaces.filter(s => s.id.startsWith(selector))
        : [];
    if (byPrefix.length === 1) {
      return byPrefix[0];
    }
    throw new CliError(
      `ワークスペースが見つからない: ${selector}`,
      `候補: ${spaces.map(s => s.label).join(' / ')}`
    );
  }

  private async loadSpaces(): Promise<Space[]> {
    const data = await this.graphql.request<{
      workspaces: Array<{ id: string; name?: string | null }>;
    }>(WORKSPACES_QUERY, {});

    return data.workspaces.map(
      ws =>
        new Space(
          ws.id,
          ws.name ?? ws.id,
          this.config.serverUrl,
          this.graphql,
          this.blobs
        )
    );
  }

  /**
   * 画面に出ている名前を読み込む。表示や名前での指定に要るときだけ呼ぶ
   * （ワークスペースごとにルート文書を1回読むため）。
   */
  async withNames(spaces: Space[]): Promise<Space[]> {
    for (const space of spaces) {
      if (space.named) {
        continue;
      }
      space.name = (await this.displayName(space.id)) ?? space.name;
      space.named = true;
    }
    return spaces;
  }

  /** 画面に出ている名前（ルート文書の meta.name）。読めなければ undefined */
  private async displayName(workspaceId: string): Promise<string | undefined> {
    try {
      const sync = await this.syncFor(workspaceId);
      const state = await sync.loadDoc(workspaceId, workspaceId);
      return state ? workspaceName(state) : undefined;
    } catch {
      return undefined;
    }
  }

  // ─── 同期接続 ───────────────────────────────────────────

  /**
   * そのワークスペースに参加済みの同期接続を返す。
   *
   * 拒否されたらトークンを取り直して1回だけやり直す。失効したトークンは
   * サーバーが接続ごと切るため、参加済みのワークスペースにも入り直す。
   */
  async syncFor(workspaceId: string): Promise<SyncClient> {
    if (this.sync && this.joined.has(workspaceId)) {
      return this.sync;
    }

    if (!this.sync) {
      this.sync = new SyncClient(this.config.serverUrl);
      await this.sync.connect(await this.auth.getToken());
    }
    if ((await this.sync.join(workspaceId)) === JoinResult.Joined) {
      this.joined.add(workspaceId);
      return this.sync;
    }

    await this.sync.connect(await this.auth.refresh());
    const rejoin = [...this.joined, workspaceId];
    this.joined.clear();
    for (const id of rejoin) {
      if ((await this.sync.join(id)) !== JoinResult.Joined) {
        throw new CliError(
          `ワークスペースに参加できない: ${id}`,
          '管理者にこのアカウントを招待してもらう'
        );
      }
      this.joined.add(id);
    }
    return this.sync;
  }

  close(): void {
    this.sync?.close();
    this.sync = null;
    this.joined.clear();
  }
}
