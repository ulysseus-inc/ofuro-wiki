import { ObjectType, Field, Int, InputType, GraphQLISODateTime } from '@nestjs/graphql';
import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

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
