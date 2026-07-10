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
    # OPTFLAGS を空にしてポータブルビルドにする。既定の -march=native は
    # ビルドマシン（CI ランナー等）の CPU 命令セットに最適化されるため、
    # 配布イメージを古い CPU（GCE e2 等）で実行すると SIGILL でクラッシュする。
    make OPTFLAGS=""; \
    make install; \
    cd /; \
    rm -rf /tmp/pgvector; \
    apk del .pgvector-build-deps

# 初期化SQL（pgroonga / pgvector 拡張の有効化）をイメージに同梱する。
# ホスト側ファイルのバインドマウント前提だと、リポジトリを clone しない
# クイックスタート（compose + .env のみ取得）で初期化に失敗するため。
COPY pgroonga-init.sql /docker-entrypoint-initdb.d/01-pgroonga.sql
