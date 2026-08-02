import { ObjectType, Field, Int, InputType, GraphQLISODateTime } from '@nestjs/graphql';
import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@ObjectType()
export class AdminUserItem {
  @Field()
  id: string;

  @Field()
  email: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field()
  isAdmin: boolean;

  @Field()
  emailVerified: boolean;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class AdminUserList {
  @Field(() => [AdminUserItem])
  items: AdminUserItem[];

  @Field(() => Int)
  totalCount: number;
}

@ObjectType()
export class ServerSettingType {
  @Field()
  key: string;

  @Field()
  value: string;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class BackupRecordType {
  @Field()
  id: string;

  @Field()
  filename: string;

  @Field()
  size: string; // BigInt serialized as string

  @Field(() => Int)
  workspaceCount: number;

  @Field(() => Int)
  docCount: number;

  @Field(() => Int)
  blobCount: number;

  @Field()
  status: string;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  createdBy?: string;
}

@ObjectType()
export class BackupRecordList {
  @Field(() => [BackupRecordType])
  items: BackupRecordType[];

  @Field(() => Int)
  totalCount: number;
}

@InputType()
export class AdminCreateUserInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  name?: string;
}

// #92: CSV 一括登録。検証と登録で同じ形を返す（画面が同じ表で扱えるようにするため）。
@ObjectType()
export class CsvUserRowResult {
  /** CSV 上の行番号（ヘッダーを1とする）。どの行が NG かを示すために必要。 */
  @Field(() => Int)
  line: number;

  @Field()
  email: string;

  @Field({ nullable: true })
  name?: string;

  /** 検証では「登録できる見込み」、登録では「登録できた」を表す。 */
  @Field()
  ok: boolean;

  /** NG の理由。利用者が CSV を直せるよう、行ごとに具体的に返す。 */
  @Field({ nullable: true })
  error?: string;
}

@ObjectType()
export class CsvImportResult {
  @Field(() => [CsvUserRowResult])
  rows: CsvUserRowResult[];

  @Field(() => Int)
  okCount: number;

  @Field(() => Int)
  ngCount: number;
}

// #90: 監査ログの一覧。
@ObjectType()
export class AuditLogItem {
  @Field()
  id: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field()
  action: string;

  @Field({ nullable: true })
  actorId?: string;

  /** 当時のメールアドレス。利用者が削除されても残る。 */
  @Field()
  actorEmail: string;

  @Field({ nullable: true })
  actorName?: string;

  @Field({ nullable: true })
  targetType?: string;

  @Field({ nullable: true })
  targetId?: string;

  @Field({ nullable: true })
  targetName?: string;

  @Field({ nullable: true })
  workspaceId?: string;

  @Field({ nullable: true })
  ip?: string;

  @Field({ nullable: true })
  userAgent?: string;

  /** before / after / meta の3キー。画面では整形して表示する。 */
  @Field(() => GraphQLJSON, { nullable: true })
  detail?: unknown;
}

@ObjectType()
export class AuditLogList {
  @Field(() => [AuditLogItem])
  items: AuditLogItem[];

  @Field(() => Int)
  totalCount: number;
}
