import { Field, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ArrayNotEmpty, IsArray, IsEnum, IsString } from 'class-validator';
import { DOC_ROLES, type DocRole } from './doc-role';

/**
 * #97: ドキュメントの権限を操作する GraphQL の型
 * （docs/doc-permission.md 8章）。
 *
 * ⚠️ **`@InputType` の各項目には class-validator のデコレータが要る。**
 * `ValidationPipe({ whitelist: true })` は**デコレータの無い項目を黙って捨てる**ため、
 * 付け忘れると `undefined` が届き、権限が意図せず既定値で上書きされる。
 */

/**
 * ⚠️ **列挙値を手で並べないこと。**
 * 5章の権限マトリクス（`doc-role.ts`）から引くことで、
 * ロールを増やしたときに GraphQL 側も自動で追従する。
 */
export const DocRoleEnum = Object.fromEntries(
  DOC_ROLES.map((r) => [r, r]),
) as Record<DocRole, DocRole>;

registerEnumType(DocRoleEnum, {
  name: 'DocRole',
  description: 'ドキュメント単位のロール（docs/doc-permission.md 5章）',
});

@InputType()
export class GrantDocUserRolesInput {
  @Field()
  @IsString()
  workspaceId: string;

  @Field()
  @IsString()
  docId: string;

  // ⚠️ 複数人にまとめて配る。フロントの契約が配列である
  @Field(() => [String])
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userIds: string[];

  @Field(() => DocRoleEnum)
  @IsEnum(DocRoleEnum)
  role: DocRole;
}

@InputType()
export class RevokeDocUserRoleInput {
  @Field()
  @IsString()
  workspaceId: string;

  @Field()
  @IsString()
  docId: string;

  @Field()
  @IsString()
  userId: string;
}

@InputType()
export class UpdateDocUserRoleInput {
  @Field()
  @IsString()
  workspaceId: string;

  @Field()
  @IsString()
  docId: string;

  @Field()
  @IsString()
  userId: string;

  @Field(() => DocRoleEnum)
  @IsEnum(DocRoleEnum)
  role: DocRole;
}

@InputType()
export class UpdateDocDefaultRoleInput {
  @Field()
  @IsString()
  workspaceId: string;

  @Field()
  @IsString()
  docId: string;

  @Field(() => DocRoleEnum)
  @IsEnum(DocRoleEnum)
  role: DocRole;
}

// ───────────────────────────── 権限を持つ利用者の一覧

// ⚠️ **参照される側を先に書くこと。** デコレータは読み込み時に評価されるため、
// あとに書くと `Cannot access 'GrantedUserInfoType' before initialization` で
// **起動時に落ちる**（型検査では分からない）。
@ObjectType('DocGrantedUserInfo')
export class GrantedUserInfoType {
  @Field()
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  avatarUrl?: string;
}

@ObjectType()
export class GrantedDocUserType {
  @Field(() => DocRoleEnum)
  role: DocRole;

  @Field(() => GrantedUserInfoType)
  user: GrantedUserInfoType;
}

@ObjectType()
export class GrantedDocUserEdge {
  @Field()
  cursor: string;

  @Field(() => GrantedDocUserType)
  node: GrantedDocUserType;
}

@ObjectType()
export class GrantedDocUserPageInfo {
  @Field({ nullable: true })
  endCursor?: string;

  @Field()
  hasNextPage: boolean;
}

@ObjectType('PaginatedGrantedDocUserType')
export class PaginatedGrantedDocUserType {
  @Field(() => Int)
  totalCount: number;

  @Field(() => [GrantedDocUserEdge])
  edges: GrantedDocUserEdge[];

  @Field(() => GrantedDocUserPageInfo)
  pageInfo: GrantedDocUserPageInfo;
}
