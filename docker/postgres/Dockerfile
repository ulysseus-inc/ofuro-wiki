# ofuro-wiki 用 PostgreSQL イメージ
#
# ベース: groonga/pgroonga:latest-alpine-17（PostgreSQL 17 + PGroonga 全文検索）
# 追加  : pgvector（ベクトル類似度検索 / 外部RAG/検索ツール の意味検索基盤・Issue #26）
#
# PGroonga と pgvector を同一DBに共存させる。pgvector はベースイメージに
# パッケージが存在しないため、ソースから PGXS でビルドして追加する。
FROM groonga/pgroonga:latest-alpine-17

# pgvector のバージョン（リリースタグ）
ARG PGVECTOR_VERSION=v0.8.0

# ベースの PostgreSQL 17 は --with-llvm（llvm19 / clang-19）でビルドされているため、
# pgvector の JIT ビットコード生成に clang19 / llvm19-dev が必要。
# サーバーヘッダ・PGXS はベースイメージに同梱済みなので postgresql-dev は不要。
RUN set -eux; \
    apk add --no-cache --virtual .pgvector-build-deps \
        build-base \
        clang19 \
        llvm19-dev \
        git; \
    git clone --branch "${PGVECTOR_VERSION}" --depth 1 \
        https://github.com/pgvector/pgvector.git /tmp/pgvector; \
    cd /tmp/pgvector; \
    make; \
    make install; \
    cd /; \
    rm -rf /tmp/pgvector; \
    apk del .pgvector-build-deps
