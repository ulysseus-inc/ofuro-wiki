// ⚠️ print-schema.spec.ts と同じ理由で差し替える（jest は .mjs を読めない）。
// 本物と同じ名前・説明の scalar にすること
jest.mock('graphql-upload/GraphQLUpload.mjs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GraphQLScalarType } = require('graphql');
  return {
    __esModule: true,
    default: new GraphQLScalarType({
      name: 'Upload',
      description: 'The `Upload` scalar type represents a file upload.',
    }),
  };
});

import {
  buildSchema,
  getNamedType,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';
import { buildSchemaSdl } from '../../src/scripts/print-schema';

/**
 * #210: **フロントエンドが値として使う列挙を、バックエンドのスキーマに載せる。**
 *
 * ⚠️ ここで守っているのは、**型検査では1件前後しか出ないのに、実行時に壊れる**性質のもの。
 *
 * フロントエンドの `schema.ts` を codegen の生成物にすると、列挙はスキーマにあるものだけになる。
 * スキーマに無いと、フロントエンドの `FeatureType.Admin` などが `undefined` になり、比較が常に偽になる:
 *
 * | 列挙 | 壊れ方 |
 * |---|---|
 * | `NotificationType` | 同名のオブジェクト型になり、**通知が1件も描画されない** |
 * | `FeatureType` | **管理者の判定が常に偽**（管理画面の入口が消える） |
 *
 * 詳細は docs/development.md「型（schema.ts）も codegen が生成する」
 */
describe('GraphQL の列挙（#210）', () => {
  // リゾルバを全部読み込んでスキーマを組むので、少し時間がかかる
  jest.setTimeout(60_000);

  let schema: GraphQLSchema;

  beforeAll(async () => {
    const { sdl } = await buildSchemaSdl();
    schema = buildSchema(sdl);
  });

  /** 列挙の値の一覧（列挙でなければ落とす） */
  const enumValues = (name: string): string[] => {
    const type = schema.getType(name);
    expect(type).toBeInstanceOf(GraphQLEnumType);
    return (type as GraphQLEnumType).getValues().map((v) => v.value);
  };

  /** フィールドの型（リストや非 null を剥がした名前） */
  const fieldTypeName = (typeName: string, field: string): string => {
    const type = schema.getType(typeName) as GraphQLObjectType;
    expect(type).toBeInstanceOf(GraphQLObjectType);
    const f = type.getFields()[field];
    expect(f).toBeDefined();
    return getNamedType(f.type).name;
  };

  /**
   * ⚠️ 値は、フロントエンドが参照しているものを**すべて**含めること。
   * バックエンドが返さない値（例 `Payment`）でも、フロントエンドの分岐が参照している。
   * 足りないと、フロントエンドの参照が型エラーになる。
   */
  test.each([
    ['ServerFeature', ['Captcha', 'Comment', 'Copilot', 'CopilotEmbedding', 'Email', 'Indexer', 'LocalWorkspace', 'OAuth', 'Payment']],
    ['ServerDeploymentType', ['Affine', 'Selfhosted']],
    ['OAuthProviderType', ['Apple', 'GitHub', 'Google', 'OIDC']],
    ['FeatureType', ['AIEarlyAccess', 'Admin', 'EarlyAccess', 'FreePlan', 'LifetimeProPlan', 'ProPlan', 'TeamPlan', 'UnlimitedCopilot', 'UnlimitedWorkspace']],
    ['WorkspaceMemberStatus', ['Accepted', 'AllocatingSeat', 'NeedMoreSeat', 'NeedMoreSeatAndReview', 'Pending', 'UnderReview']],
    ['NotificationType', ['Comment', 'CommentMention', 'Invitation', 'InvitationAccepted', 'InvitationBlocked', 'InvitationRejected', 'InvitationReviewApproved', 'InvitationReviewDeclined', 'InvitationReviewRequest', 'Mention']],
  ])('列挙 %s がスキーマにあり、必要な値をすべて持つ', (name, values) => {
    expect(enumValues(name).sort()).toEqual([...values].sort());
  });

  /**
   * ⚠️ バックエンドが**実際に返す値**が列挙に入っていること。
   * 入っていないと、GraphQL が変換できず**問い合わせが丸ごと失敗する**。
   * （config.service.ts / user.resolver.ts / workspace.service.ts / notification.service.ts）
   */
  test.each([
    ['ServerFeature', ['Indexer', 'Comment', 'Email', 'OAuth']],
    ['ServerDeploymentType', ['Selfhosted']],
    ['OAuthProviderType', ['OIDC']],
    ['FeatureType', ['Admin']],
    ['WorkspaceMemberStatus', ['Accepted', 'Pending']],
    ['NotificationType', ['Comment', 'Mention', 'CommentMention']],
  ])('⚠️ %s に、バックエンドが返す値が入っている', (name, returned) => {
    expect(enumValues(name)).toEqual(expect.arrayContaining(returned));
  });

  test.each([
    ['ServerConfigType', 'features', 'ServerFeature'],
    ['ServerConfigType', 'type', 'ServerDeploymentType'],
    ['ServerConfigType', 'oauthProviders', 'OAuthProviderType'],
    ['UserType', 'features', 'FeatureType'],
    ['InviteUserType', 'status', 'WorkspaceMemberStatus'],
    ['InvitationType', 'status', 'WorkspaceMemberStatus'],
    ['NotificationObjectType', 'type', 'NotificationType'],
  ])('%s.%s は列挙 %s で返す', (typeName, field, enumName) => {
    expect(fieldTypeName(typeName, field)).toBe(enumName);
  });

  /**
   * ⚠️ **`NotificationType` は列挙の名前。** 通知のオブジェクト型は `NotificationObjectType`。
   * 以前はオブジェクト型が `NotificationType` で、生成物ではフロントエンドの列挙と入れ替わっていた。
   */
  test('⚠️ NotificationType はオブジェクト型ではなく列挙', () => {
    expect(schema.getType('NotificationType')).toBeInstanceOf(GraphQLEnumType);
    expect(fieldTypeName('NotificationEdge', 'node')).toBe('NotificationObjectType');
  });
});
