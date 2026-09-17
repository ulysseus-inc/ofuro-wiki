import { Field, ObjectType } from '@nestjs/graphql';

/**
 * #151: Discovery Metadata。**本文を含まない。**
 *
 * ⚠️ ここに本文・Yjs ドキュメント・エディタ状態を足さないこと
 * （docs/doc-permission.md「Discovery Index Local Cache」2）。
 */
@ObjectType('DiscoveryDocument')
export class DiscoveryDocumentType {
  @Field()
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field(() => [String])
  tagIds: string[];

  @Field()
  mode: string;

  /**
   * ⚠️ ゴミ箱に入っているか。**返さないと一覧に削除済みが出る。**
   * サーバー側で除外しないのは、ゴミ箱の一覧にも同じ Snapshot を使うため。
   */
  @Field()
  trash: boolean;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  /**
   * #151 段階3: フィールド単位の版数。
   *
   * ⚠️ **これを返さないと、クライアントは書き込み時の `baseRevision` を
   * 決められない**（競合制御が働かない）。
   * ⚠️ BigInt は JSON にできないため文字列で返す。
   */
  @Field()
  titleRevision: string;

  @Field()
  trashRevision: string;

  @Field()
  tagsRevision: string;

  @Field({ nullable: true })
  createdBy?: string;

  @Field({ nullable: true })
  updatedBy?: string;
}

/** 認可済み Snapshot。 */
@ObjectType('DiscoverySnapshot')
export class DiscoverySnapshotType {
  @Field()
  workspaceId: string;

  /** ⚠️ 誰にとって認可された結果か。キャッシュの正当性判定に要る */
  @Field()
  userId: string;

  /** ⚠️ サーバーのどの時点か。BigInt は GraphQL に無いため文字列 */
  @Field()
  revision: string;

  @Field()
  fetchedAt: string;

  @Field(() => [DiscoveryDocumentType])
  documents: DiscoveryDocumentType[];
}

/**
 * #151 段階3: Discovery Metadata の書き込み結果。
 *
 * ⚠️ **「失敗」を1つにまとめないこと。** クライアントは扱いを分ける
 * （docs/discovery-stage3-comparison.md 7.5.10）。
 *
 * | status | クライアントの扱い |
 * |---|---|
 * | `ok` | 未送信分を破棄してよい |
 * | `stale` | **返した現在値をローカルへ反映してから**未送信分を捨てる |
 * | `not-found` | 台帳に行が無い。再取得する |
 *
 * 権限が無い場合は GraphQL エラー（`ForbiddenException`）。
 * ⚠️ **「権限が無い」と「存在しない」を区別できるようにしないこと。**
 * 区別できると、権限外のページの存在が分かってしまう。
 */
@ObjectType('DocMetaWriteResult')
export class DocMetaWriteResultType {
  @Field()
  status: string;

  /**
   * 書き込み後（stale なら現在）の版数。
   * ⚠️ BigInt は JSON にできないため文字列で返す（`discoveryRevision` と同じ）。
   */
  @Field({ nullable: true })
  revision?: string;

  /** ⚠️ stale のときだけ返す。「取ってから捨てる」ために要る（7.5.10） */
  @Field({ nullable: true })
  currentTitle?: string;

  /** ⚠️ 同上 */
  @Field({ nullable: true })
  currentTrash?: boolean;

  /**
   * #151 段階3: **作成したときの、3フィールドそれぞれの版数。**
   *
   * ⚠️ **`revision`（単数）で代用できない。** あれは「いま書いた
   * フィールドの版数」であり、作成は3つ同時に採番する。
   *
   * ⚠️ **クライアントが「作成時は全部 1」と推測してはいけない。**
   * `createDoc` は冪等な upsert なので、再送では**既にある行の版数**が
   * 返る。推測すると、改名済みのページを再送したときに
   * trash / tags へ嘘の版数を書く。
   *
   * これを返さないと、作成直後の題の書き込みが baseRevision 0 で送られ、
   * サーバーの 1 と食い違って**必ず stale になり、打った題が消える**
   * （7.12）。
   */
  @Field({ nullable: true })
  titleRevision?: string;

  /** ⚠️ 同上 */
  @Field({ nullable: true })
  trashRevision?: string;

  /** ⚠️ 同上 */
  @Field({ nullable: true })
  tagsRevision?: string;
}
