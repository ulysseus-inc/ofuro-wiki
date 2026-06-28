import {
  ObjectType,
  Field,
  ID,
  Int,
  InputType,
  registerEnumType,
} from '@nestjs/graphql';
import { Allow } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import { PublicUserType } from '../search/search.resolver';
import { PageInfo } from '../user/user.model';

// --- Enums ---

export enum CommentChangeAction {
  update = 'update',
  delete = 'delete',
}

registerEnumType(CommentChangeAction, { name: 'CommentChangeAction' });

@ObjectType('ReplyObjectType')
export class ReplyObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  commentId: string;

  @Field(() => GraphQLJSON)
  content: any;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => PublicUserType)
  user: PublicUserType;
}

@ObjectType('CommentObjectType')
export class CommentObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => GraphQLJSON)
  content: any;

  @Field()
  resolved: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => PublicUserType)
  user: PublicUserType;

  @Field(() => [ReplyObjectType])
  replies: ReplyObjectType[];
}

@ObjectType('CommentChangeObjectType')
export class CommentChangeObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { nullable: true })
  commentId?: string;

  @Field(() => CommentChangeAction)
  action: CommentChangeAction;

  @Field(() => GraphQLJSON)
  item: any;
}

// --- Pagination Types ---

@ObjectType()
class CommentEdge {
  @Field()
  cursor: string;

  @Field(() => CommentObjectType)
  node: CommentObjectType;
}

@ObjectType('PaginatedCommentObjectType')
export class PaginatedCommentObjectType {
  @Field(() => Int)
  totalCount: number;

  @Field(() => [CommentEdge])
  edges: CommentEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}

@ObjectType()
class CommentChangeEdge {
  @Field()
  cursor: string;

  @Field(() => CommentChangeObjectType)
  node: CommentChangeObjectType;
}

@ObjectType('PaginatedCommentChangeObjectType')
export class PaginatedCommentChangeObjectType {
  @Field(() => Int)
  totalCount: number;

  @Field(() => [CommentChangeEdge])
  edges: CommentChangeEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}

// --- Input Types ---

@InputType('CommentCreateInput')
export class CommentCreateInput {
  @Allow()
  @Field(() => ID)
  workspaceId: string;

  @Allow()
  @Field(() => ID)
  docId: string;

  @Allow()
  @Field()
  docMode: string;

  @Allow()
  @Field()
  docTitle: string;

  @Allow()
  @Field(() => GraphQLJSON)
  content: any;

  @Allow()
  @Field(() => [String], { nullable: true })
  mentions?: string[];
}

@InputType('CommentUpdateInput')
export class CommentUpdateInput {
  @Allow()
  @Field(() => ID)
  id: string;

  @Allow()
  @Field(() => GraphQLJSON)
  content: any;
}

@InputType('CommentResolveInput')
export class CommentResolveInput {
  @Allow()
  @Field(() => ID)
  id: string;

  @Allow()
  @Field()
  resolved: boolean;
}

@InputType('ReplyCreateInput')
export class ReplyCreateInput {
  @Allow()
  @Field(() => ID)
  commentId: string;

  @Allow()
  @Field(() => GraphQLJSON)
  content: any;

  @Allow()
  @Field()
  docMode: string;

  @Allow()
  @Field()
  docTitle: string;

  @Allow()
  @Field(() => [String], { nullable: true })
  mentions?: string[];
}

@InputType('ReplyUpdateInput')
export class ReplyUpdateInput {
  @Allow()
  @Field(() => ID)
  id: string;

  @Allow()
  @Field(() => GraphQLJSON)
  content: any;
}

@InputType('MentionDocInput')
export class MentionDocInput {
  @Allow()
  @Field()
  id: string;

  @Allow()
  @Field()
  title: string;

  @Allow()
  @Field()
  mode: string;

  @Allow()
  @Field({ nullable: true })
  blockId?: string;

  @Allow()
  @Field({ nullable: true })
  elementId?: string;
}

@InputType('MentionInput')
export class MentionInput {
  @Allow()
  @Field()
  userId: string;

  @Allow()
  @Field()
  workspaceId: string;

  @Allow()
  @Field(() => MentionDocInput)
  doc: MentionDocInput;
}
