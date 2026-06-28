import {
  Resolver,
  Query,
  Args,
  ResolveField,
  Parent,
  Mutation,
  ObjectType,
  Field,
  Int,
  Float,
  InputType,
  registerEnumType,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { IndexerService } from './indexer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceType } from '../workspace/workspace.model';
import GraphQLJSON from 'graphql-type-json';

// ─── Enums ──────────────────────────────────────────────────

enum SearchTable {
  block = 'block',
  doc = 'doc',
}
registerEnumType(SearchTable, { name: 'SearchTable', description: 'Search table' });

enum SearchQueryType {
  all = 'all',
  boolean = 'boolean',
  boost = 'boost',
  exists = 'exists',
  match = 'match',
}
registerEnumType(SearchQueryType, { name: 'SearchQueryType', description: 'Search query type' });

enum SearchQueryOccur {
  must = 'must',
  must_not = 'must_not',
  should = 'should',
}
registerEnumType(SearchQueryOccur, { name: 'SearchQueryOccur', description: 'Search query occur' });

// ─── Input Types ────────────────────────────────────────────

@InputType()
class SearchQuery {
  @Field(() => SearchQueryType)
  type: SearchQueryType;

  @Field({ nullable: true })
  field?: string;

  @Field({ nullable: true })
  match?: string;

  @Field(() => SearchQueryOccur, { nullable: true })
  occur?: SearchQueryOccur;

  @Field(() => [SearchQuery], { nullable: true })
  queries?: SearchQuery[];

  @Field(() => SearchQuery, { nullable: true })
  query?: SearchQuery;

  @Field(() => Float, { nullable: true })
  boost?: number;
}

@InputType()
class SearchHighlight {
  @Field()
  field: string;

  @Field()
  before: string;

  @Field()
  end: string;
}

@InputType()
class SearchPagination {
  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Int, { nullable: true })
  skip?: number;

  @Field({ nullable: true })
  cursor?: string;
}

@InputType()
class SearchOptions {
  @Field(() => [String])
  fields: string[];

  @Field(() => [SearchHighlight], { nullable: true })
  highlights?: SearchHighlight[];

  @Field(() => SearchPagination, { nullable: true })
  pagination?: SearchPagination;
}

@InputType()
class SearchInput {
  @Field(() => SearchTable)
  table: SearchTable;

  @Field(() => SearchQuery)
  query: SearchQuery;

  @Field(() => SearchOptions)
  options: SearchOptions;
}

@InputType()
class AggregateHitsPagination {
  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Int, { nullable: true })
  skip?: number;
}

@InputType()
class AggregateHitsOptions {
  @Field(() => [String])
  fields: string[];

  @Field(() => [SearchHighlight], { nullable: true })
  highlights?: SearchHighlight[];

  @Field(() => AggregateHitsPagination, { nullable: true })
  pagination?: AggregateHitsPagination;
}

@InputType()
class AggregateOptions {
  @Field(() => AggregateHitsOptions)
  hits: AggregateHitsOptions;

  @Field(() => SearchPagination, { nullable: true })
  pagination?: SearchPagination;
}

@InputType()
class AggregateInput {
  @Field(() => SearchTable)
  table: SearchTable;

  @Field(() => SearchQuery)
  query: SearchQuery;

  @Field()
  field: string;

  @Field(() => AggregateOptions)
  options: AggregateOptions;
}

@InputType()
class SearchDocsInput {
  @Field()
  keyword: string;

  @Field(() => Int, { nullable: true })
  limit?: number;
}

// ─── Output Types ───────────────────────────────────────────

@ObjectType()
class SearchResultPagination {
  @Field(() => Int)
  count: number;

  @Field()
  hasMore: boolean;

  @Field({ nullable: true })
  nextCursor?: string;
}

@ObjectType()
class SearchNodeObjectType {
  @Field(() => GraphQLJSON)
  fields: Record<string, any>;

  @Field(() => GraphQLJSON, { nullable: true })
  highlights?: Record<string, any>;
}

@ObjectType()
class SearchResultObjectType {
  @Field(() => [SearchNodeObjectType])
  nodes: SearchNodeObjectType[];

  @Field(() => SearchResultPagination)
  pagination: SearchResultPagination;
}

@ObjectType()
class AggregateBucketHitsObjectType {
  @Field(() => [SearchNodeObjectType])
  nodes: SearchNodeObjectType[];
}

@ObjectType()
class AggregateBucketObjectType {
  @Field()
  key: string;

  @Field(() => Int)
  count: number;

  @Field(() => AggregateBucketHitsObjectType)
  hits: AggregateBucketHitsObjectType;

  @Field(() => Float, { nullable: true })
  score?: number;
}

@ObjectType()
class AggregateResultObjectType {
  @Field(() => [AggregateBucketObjectType])
  buckets: AggregateBucketObjectType[];

  @Field(() => SearchResultPagination)
  pagination: SearchResultPagination;
}

@ObjectType()
export class PublicUserType {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  avatarUrl?: string;
}

@ObjectType()
class SearchDocObjectType {
  @Field()
  docId: string;

  @Field()
  title: string;

  @Field()
  blockId: string;

  @Field()
  highlight: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => PublicUserType, { nullable: true })
  createdByUser?: PublicUserType;

  @Field(() => PublicUserType, { nullable: true })
  updatedByUser?: PublicUserType;
}

// ─── Resolver ───────────────────────────────────────────────

@Resolver(() => WorkspaceType)
@UseGuards(JwtAuthGuard)
export class SearchResolver {
  constructor(
    private searchService: SearchService,
    private indexerService: IndexerService,
  ) {}

  @ResolveField(() => SearchResultObjectType, { name: 'search' })
  async search(
    @Parent() workspace: WorkspaceType,
    @Args('input', { type: () => SearchInput }) input: SearchInput,
  ): Promise<SearchResultObjectType> {
    return this.searchService.searchWithDSL(workspace.id, input);
  }

  @ResolveField(() => AggregateResultObjectType, { name: 'aggregate' })
  async aggregate(
    @Parent() workspace: WorkspaceType,
    @Args('input', { type: () => AggregateInput }) input: AggregateInput,
  ): Promise<AggregateResultObjectType> {
    return this.searchService.aggregateWithDSL(workspace.id, input);
  }

  @ResolveField(() => [SearchDocObjectType], { name: 'searchDocs' })
  async searchDocs(
    @Parent() workspace: WorkspaceType,
    @Args('input', { type: () => SearchDocsInput }) input: SearchDocsInput,
  ): Promise<SearchDocObjectType[]> {
    return this.searchService.searchDocsKeyword(workspace.id, input.keyword, input.limit);
  }

  @Mutation(() => Boolean)
  async reindexWorkspace(
    @Args('workspaceId') workspaceId: string,
  ): Promise<boolean> {
    await this.indexerService.indexAllDocuments(workspaceId);
    return true;
  }
}
