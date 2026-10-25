import { CliError, notFound } from '../errors';
import { GraphqlError, type GraphqlClient } from '../transport/graphql';

/**
 * ページ台帳（#151 段階3 の Discovery Index）。ブラウザの一覧と同じ経路。
 *
 * ⚠️ 一覧に `workspaceDocs` は使わない。ゴミ箱状態と版数を返さないため、
 * ゴミ箱のページが混ざり、題・ゴミ箱の書き込みに要る版数も取れない。
 */
export interface LedgerDoc {
  id: string;
  title: string;
  trash: boolean;
  updatedAt: string;
  titleRevision: string;
  trashRevision: string;
  /** 付いているタグの ID（#276）。名前は TagCatalog で引く */
  tagIds: string[];
}

/** ゴミ箱の状態。`setTrash(doc, true)` では意図が読めないため enum にする */
export enum TrashState {
  Trashed,
  Restored,
}

export interface SearchHit {
  docId: string;
  title: string;
  highlight: string;
}

enum WriteStatus {
  Ok = 'ok',
  Stale = 'stale',
  NotFound = 'not-found',
}

interface WriteResult {
  status: WriteStatus;
  titleRevision?: string;
}

const FORBIDDEN = 'FORBIDDEN';

const SNAPSHOT_QUERY = `query ($workspaceId: String!) {
  discoverySnapshot(workspaceId: $workspaceId) {
    documents { id title trash updatedAt titleRevision trashRevision tagIds }
  }
}`;

const SEARCH_QUERY = `query ($workspaceId: String!, $input: SearchDocsInput!) {
  workspace(id: $workspaceId) {
    searchDocs(input: $input) { docId title highlight }
  }
}`;

const CREATE_MUTATION = `mutation ($workspaceId: String!, $docId: String!, $title: String) {
  createDocMeta(workspaceId: $workspaceId, docId: $docId, title: $title, mode: "page") {
    status titleRevision
  }
}`;

const TITLE_MUTATION = `mutation ($workspaceId: String!, $docId: String!, $title: String!, $baseRevision: String!) {
  setDocTitle(workspaceId: $workspaceId, docId: $docId, title: $title, baseRevision: $baseRevision) {
    status
  }
}`;

const TRASH_MUTATION = `mutation ($workspaceId: String!, $docId: String!, $trash: Boolean!, $baseRevision: String!) {
  setDocTrash(workspaceId: $workspaceId, docId: $docId, trash: $trash, baseRevision: $baseRevision) {
    status
  }
}`;

const TAGS_MUTATION = `mutation ($workspaceId: String!, $docId: String!, $add: [String!], $remove: [String!]) {
  changeDocTags(workspaceId: $workspaceId, docId: $docId, add: $add, remove: $remove) {
    status
  }
}`;

const DELETE_MUTATION = `mutation ($workspaceId: String!, $docId: String!) {
  deleteDocMeta(workspaceId: $workspaceId, docId: $docId) { status }
}`;

export class Ledger {
  constructor(
    private readonly graphql: GraphqlClient,
    private readonly workspaceId: string
  ) {}

  /** 読めるページだけが返る（サーバーが権限で絞る） */
  async documents(): Promise<LedgerDoc[]> {
    const data = await this.graphql.request<{
      discoverySnapshot: { documents: LedgerDoc[] };
    }>(SNAPSHOT_QUERY, { workspaceId: this.workspaceId });
    return data.discoverySnapshot.documents.map(d => ({
      ...d,
      title: d.title ?? '',
      tagIds: d.tagIds ?? [],
    }));
  }

  async find(docId: string): Promise<LedgerDoc> {
    const doc = (await this.documents()).find(d => d.id === docId);
    if (!doc) {
      throw notFound(docId);
    }
    return doc;
  }

  async search(keyword: string, limit: number): Promise<SearchHit[]> {
    const data = await this.graphql.request<{
      workspace: { searchDocs: SearchHit[] };
    }>(SEARCH_QUERY, {
      workspaceId: this.workspaceId,
      input: { keyword, limit },
    });
    return data.workspace.searchDocs;
  }

  /** 冪等。既にあれば何も変えない（サーバー側 upsert） */
  async create(docId: string, title: string): Promise<void> {
    const data = await this.write<{ createDocMeta: WriteResult }>(
      docId,
      CREATE_MUTATION,
      { docId, title }
    );
    expectOk(data.createDocMeta, docId);
  }

  async setTitle(doc: LedgerDoc, title: string): Promise<void> {
    const data = await this.write<{ setDocTitle: WriteResult }>(
      doc.id,
      TITLE_MUTATION,
      { docId: doc.id, title, baseRevision: doc.titleRevision }
    );
    expectOk(data.setDocTitle, doc.id);
  }

  async setTrash(doc: LedgerDoc, state: TrashState): Promise<void> {
    const data = await this.write<{ setDocTrash: WriteResult }>(
      doc.id,
      TRASH_MUTATION,
      {
        docId: doc.id,
        trash: state === TrashState.Trashed,
        baseRevision: doc.trashRevision,
      }
    );
    expectOk(data.setDocTrash, doc.id);
  }

  /**
   * タグを要素単位で付ける・外す（#276）。
   * ⚠️ 配列全体を送らない。同時に別のタグを付けた人の分が消える
   */
  async changeTags(
    docId: string,
    add: string[],
    remove: string[]
  ): Promise<void> {
    const data = await this.write<{ changeDocTags: WriteResult }>(
      docId,
      TAGS_MUTATION,
      { docId, add, remove }
    );
    expectOk(data.changeDocTags, docId);
  }

  /** 本文・索引・台帳をサーバーが1トランザクションで消す（docs/permanent-delete.md 5章） */
  async purge(docId: string): Promise<void> {
    const data = await this.write<{ deleteDocMeta: WriteResult }>(
      docId,
      DELETE_MUTATION,
      { docId }
    );
    expectOk(data.deleteDocMeta, docId);
  }

  /** 権限不足は不在と同じ文言にする（サーバーと同じ方針） */
  private async write<T>(
    docId: string,
    mutation: string,
    variables: object
  ): Promise<T> {
    try {
      return await this.graphql.request<T>(mutation, {
        workspaceId: this.workspaceId,
        ...variables,
      });
    } catch (e) {
      if (e instanceof GraphqlError && e.code === FORBIDDEN) {
        throw notFound(docId);
      }
      throw e;
    }
  }
}

function expectOk(result: WriteResult, docId: string): void {
  if (result.status === WriteStatus.Ok) {
    return;
  }
  if (result.status === WriteStatus.NotFound) {
    throw notFound(docId);
  }
  throw new CliError(
    `他の人が同時に変更した: ${docId}`,
    'ofuro read で読み直してからやり直す'
  );
}
