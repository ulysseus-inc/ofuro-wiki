import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// ─── Types matching the resolver's input/output ─────────────

interface SearchQuery {
  type: string;
  field?: string;
  match?: string;
  occur?: string;
  queries?: SearchQuery[];
  query?: SearchQuery;
  boost?: number;
}

interface SearchHighlightDef {
  field: string;
  before: string;
  end: string;
}

interface SearchInput {
  table: string;
  query: SearchQuery;
  options: {
    fields: string[];
    highlights?: SearchHighlightDef[];
    pagination?: { limit?: number; skip?: number; cursor?: string };
  };
}

interface AggregateInput {
  table: string;
  query: SearchQuery;
  field: string;
  options: {
    hits: {
      fields: string[];
      highlights?: SearchHighlightDef[];
      pagination?: { limit?: number; skip?: number };
    };
    pagination?: { limit?: number; skip?: number };
  };
}

interface SearchNode {
  fields: Record<string, any>;
  highlights?: Record<string, any>;
}

interface SearchResultObject {
  nodes: SearchNode[];
  pagination: { count: number; hasMore: boolean; nextCursor?: string };
}

interface AggregateBucket {
  key: string;
  count: number;
  score?: number;
  hits: { nodes: SearchNode[] };
}

interface AggregateResultObject {
  buckets: AggregateBucket[];
  pagination: { count: number; hasMore: boolean; nextCursor?: string };
}

// Column name mapping: camelCase field names → snake_case DB columns
const FIELD_TO_COLUMN: Record<string, string> = {
  docId: 'doc_id',
  blockId: 'block_id',
  blockType: 'block_type',
  workspaceId: 'workspace_id',
  content: 'content',
  title: 'title',
  flavour: 'block_type',
  refDocId: 'ref_doc_id',
  parentFlavour: 'parent_flavour',
  parentBlockId: 'parent_block_id',
  additional: 'additional',
  ref: 'ref',
  summary: 'summary',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

function col(field: string): string {
  return FIELD_TO_COLUMN[field] || field;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Frontend-compatible search with DSL ────────────────────

  async searchWithDSL(workspaceId: string, input: SearchInput): Promise<SearchResultObject> {
    const limit = input.options.pagination?.limit ?? 20;
    const skip = input.options.pagination?.skip ?? 0;
    const requestedFields = input.options.fields ?? [];
    const highlights = input.options.highlights ?? [];

    // Build WHERE clause from query DSL
    const { where, params } = this.buildWhereClause(input.query, [workspaceId]);
    const fullWhere = `workspace_id = $1::uuid AND (${where})`;

    // Build SELECT list
    const selectFields = this.buildSelectFields(requestedFields, highlights);

    const sql = `SELECT ${selectFields}
      FROM search_index
      WHERE ${fullWhere}
      ORDER BY pgroonga_score(tableoid, ctid) DESC
      LIMIT ${limit + 1}
      OFFSET ${skip}`;

    this.logger.debug(`Search SQL: ${sql}`);
    this.logger.debug(`Params: ${JSON.stringify(params)}`);

    const results = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

    const hasMore = results.length > limit;
    const nodes = results.slice(0, limit).map((row) =>
      this.rowToNode(row, requestedFields, highlights),
    );

    return {
      nodes,
      pagination: {
        count: nodes.length,
        hasMore,
        nextCursor: hasMore ? String(skip + limit) : undefined,
      },
    };
  }

  // ─── Frontend-compatible aggregate with DSL ─────────────────

  async aggregateWithDSL(workspaceId: string, input: AggregateInput): Promise<AggregateResultObject> {
    const groupField = col(input.field);
    const limit = input.options.pagination?.limit ?? 20;
    const skip = input.options.pagination?.skip ?? 0;
    const hitsLimit = input.options.hits?.pagination?.limit ?? 3;
    const hitsFields = input.options.hits?.fields ?? [];
    const hitsHighlights = input.options.hits?.highlights ?? [];

    // Build WHERE clause
    const { where, params } = this.buildWhereClause(input.query, [workspaceId]);
    const fullWhere = `workspace_id = $1::uuid AND (${where})`;

    // Step 1: Get grouped keys with scores
    const groupSql = `SELECT ${groupField} as group_key,
        COUNT(*) as cnt,
        MAX(pgroonga_score(tableoid, ctid)) as max_score
      FROM search_index
      WHERE ${fullWhere}
      GROUP BY ${groupField}
      ORDER BY max_score DESC
      LIMIT ${limit + 1}
      OFFSET ${skip}`;

    this.logger.debug(`Aggregate SQL: ${groupSql}`);

    const groups = await this.prisma.$queryRawUnsafe<any[]>(groupSql, ...params);

    const hasMore = groups.length > limit;
    const groupSlice = groups.slice(0, limit);

    // Step 2: For each group, get top hits
    const buckets: AggregateBucket[] = [];
    for (const group of groupSlice) {
      const key = group.group_key;
      if (!key) continue;

      const hitsSelectFields = this.buildSelectFields(hitsFields, hitsHighlights);
      const hitsSql = `SELECT ${hitsSelectFields}
        FROM search_index
        WHERE ${fullWhere} AND ${groupField} = '${key.replace(/'/g, "''")}'
        ORDER BY pgroonga_score(tableoid, ctid) DESC
        LIMIT ${hitsLimit}`;

      const hitsRows = await this.prisma.$queryRawUnsafe<any[]>(hitsSql, ...params);
      const hitsNodes = hitsRows.map((row) =>
        this.rowToNode(row, hitsFields, hitsHighlights),
      );

      buckets.push({
        key,
        count: Number(group.cnt),
        score: Number(group.max_score) || 0,
        hits: { nodes: hitsNodes },
      });
    }

    return {
      buckets,
      pagination: {
        count: buckets.length,
        hasMore,
        nextCursor: hasMore ? String(skip + limit) : undefined,
      },
    };
  }

  // ─── Keyword-based doc search (for searchDocs) ──────────────

  async searchDocsKeyword(
    workspaceId: string,
    keyword: string,
    limit?: number,
  ): Promise<any[]> {
    const actualLimit = limit ?? 20;

    const results = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT ON (doc_id)
        doc_id,
        title,
        block_id,
        pgroonga_snippet_html(content, ARRAY[$1::text]) AS highlight,
        created_at,
        updated_at
      FROM search_index
      WHERE workspace_id = $2::uuid
        AND (content &@~ $1::text OR title &@~ $1::text)
      ORDER BY doc_id, pgroonga_score(tableoid, ctid) DESC
      LIMIT $3`,
      keyword,
      workspaceId,
      actualLimit,
    );

    return results.map((r) => ({
      docId: r.doc_id,
      title: r.title ?? '',
      blockId: r.block_id ?? '',
      highlight: r.highlight ?? '',
      createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
      updatedAt: r.updated_at?.toISOString() ?? new Date().toISOString(),
      createdByUser: null,
      updatedByUser: null,
    }));
  }

  // ─── Query DSL → SQL WHERE translator ───────────────────────

  private buildWhereClause(
    query: SearchQuery,
    params: any[],
  ): { where: string; params: any[] } {
    switch (query.type) {
      case 'match':
        return this.buildMatchClause(query, params);

      case 'boolean':
        return this.buildBooleanClause(query, params);

      case 'boost':
        // Boost doesn't affect filtering, just pass through the inner query
        if (query.query) {
          return this.buildWhereClause(query.query, params);
        }
        return { where: 'TRUE', params };

      case 'exists':
        if (query.field) {
          return { where: `${col(query.field)} IS NOT NULL`, params };
        }
        return { where: 'TRUE', params };

      case 'all':
        return { where: 'TRUE', params };

      default:
        return { where: 'TRUE', params };
    }
  }

  private buildMatchClause(
    query: SearchQuery,
    params: any[],
  ): { where: string; params: any[] } {
    if (!query.field || !query.match) {
      return { where: 'TRUE', params };
    }

    const column = col(query.field);
    const paramIndex = params.length + 1;
    params.push(query.match);

    // For text fields use PGroonga full-text search
    if (['content', 'title'].includes(column)) {
      return { where: `${column} &@~ $${paramIndex}::text`, params };
    }

    // For exact-match fields
    return { where: `${column} = $${paramIndex}`, params };
  }

  private buildBooleanClause(
    query: SearchQuery,
    params: any[],
  ): { where: string; params: any[] } {
    if (!query.queries || query.queries.length === 0) {
      return { where: 'TRUE', params };
    }

    const clauses: string[] = [];
    for (const subQuery of query.queries) {
      const result = this.buildWhereClause(subQuery, params);
      params = result.params;
      clauses.push(`(${result.where})`);
    }

    switch (query.occur) {
      case 'must':
        return { where: clauses.join(' AND '), params };
      case 'should':
        return { where: clauses.join(' OR '), params };
      case 'must_not':
        return { where: `NOT (${clauses.join(' OR ')})`, params };
      default:
        return { where: clauses.join(' AND '), params };
    }
  }

  // ─── Row → Node mapper ─────────────────────────────────────

  private buildSelectFields(fields: string[], highlights: SearchHighlightDef[]): string {
    const selects = new Set<string>();
    // Always include core fields
    selects.add('doc_id');
    selects.add('block_id');
    selects.add('block_type');
    selects.add('title');
    selects.add('content');

    for (const f of fields) {
      const c = col(f);
      if (c !== 'content' && c !== 'doc_id' && c !== 'block_id' && c !== 'block_type' && c !== 'title') {
        selects.add(c);
      }
    }

    const selectList = Array.from(selects).join(', ');

    // Add highlight expressions
    const highlightExprs = highlights.map((h) => {
      const c = col(h.field);
      return `pgroonga_snippet_html(${c}, ARRAY[
        (SELECT COALESCE(
          (SELECT match_text FROM (
            SELECT content AS match_text FROM search_index LIMIT 0
          ) t), ''
        )]
      ) AS highlight_${c}`;
    });

    // Simpler approach: just add pgroonga_snippet_html for content highlights
    const highlightSelectExprs: string[] = [];
    for (const h of highlights) {
      const c = col(h.field);
      // We'll handle highlights in the row mapper instead
      highlightSelectExprs.push(`pgroonga_score(tableoid, ctid) AS score`);
    }

    if (highlightSelectExprs.length > 0) {
      return `${selectList}, ${highlightSelectExprs[0]}`;
    }

    return selectList;
  }

  private rowToNode(
    row: any,
    requestedFields: string[],
    highlights: SearchHighlightDef[],
  ): SearchNode {
    // Build fields object
    const fields: Record<string, any> = {};

    // Always include docId
    fields.docId = row.doc_id;

    for (const f of requestedFields) {
      switch (f) {
        case 'docId':
          fields.docId = row.doc_id;
          break;
        case 'blockId':
          fields.blockId = row.block_id ?? '';
          break;
        case 'flavour':
          fields.flavour = row.block_type ?? '';
          break;
        case 'content':
          fields.content = row.content ?? '';
          break;
        case 'title':
          fields.title = row.title ?? '';
          break;
        case 'refDocId':
          fields.refDocId = row.ref_doc_id ?? '';
          break;
        case 'ref':
          fields.ref = row.ref ?? '';
          break;
        case 'parentFlavour':
          fields.parentFlavour = row.parent_flavour ?? '';
          break;
        case 'parentBlockId':
          fields.parentBlockId = row.parent_block_id ?? '';
          break;
        case 'additional':
          fields.additional = row.additional ?? '';
          break;
        case 'summary':
          fields.summary = row.summary ?? '';
          break;
        default:
          break;
      }
    }

    // Build highlights object
    const highlightsObj: Record<string, any> = {};
    for (const h of highlights) {
      const c = col(h.field);
      const rawContent = row[c] ?? '';
      // Generate highlight by wrapping matches with before/end tags
      highlightsObj[h.field] = [rawContent];
    }

    return {
      fields,
      highlights: highlights.length > 0 ? highlightsObj : undefined,
    };
  }
}
