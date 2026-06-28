-- Enable PGroonga extension for Japanese full-text search
CREATE EXTENSION IF NOT EXISTS pgroonga;

-- Enable pgvector extension for semantic (vector similarity) search
-- 外部RAG/検索ツール の意味検索基盤（Issue #26）。pgroonga と同一DBに共存させる。
CREATE EXTENSION IF NOT EXISTS vector;
