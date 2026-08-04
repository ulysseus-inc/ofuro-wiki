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

# ベースの PostgreSQL は --with-llvm でビルドされており、pgvector の
# JIT ビットコード生成には**ベースと同じメジャーバージョン**の clang / llvm が要る。
# サーバーヘッダ・PGXS はベースイメージに同梱済みなので postgresql-dev は不要。
#
# ⚠️ **バージョンを直接書かないこと。**
# ベースは `latest-alpine-17` で固定していないため、上流が LLVM を上げると
# `clangNN (no such package)` でビルドが壊れる。実際に 19 → 21 へ上がって壊れた
# （2026-08-04。19 を書いていたが、その時点のベースは既に 21 だった）。
#
# PostgreSQL 自身が Makefile.global に「どの clang でビルドしたか」を残しているので、
# **推測せずそこから読み取る。**
RUN set -eux; \
    GLOBAL="$(pg_config --pgxs | xargs dirname)/../Makefile.global"; \
    LLVM_MAJOR="$(grep -E '^CLANG ' "$GLOBAL" | sed -E 's/.*clang-([0-9]+).*/\1/')"; \
    # ⚠️ 取り出しに失敗したら止める。空のまま進むと apk が `clang` を掴んで
    # ベースと異なるバージョンでビルドされ、**JIT が黙って効かなくなる**
    echo "$LLVM_MAJOR" | grep -qE '^[0-9]+$'; \
    echo "base PostgreSQL was built with LLVM ${LLVM_MAJOR}"; \
    apk add --no-cache --virtual .pgvector-build-deps \
        build-base \
        "clang${LLVM_MAJOR}" \
        "llvm${LLVM_MAJOR}-dev" \
        git; \
    git clone --branch "${PGVECTOR_VERSION}" --depth 1 \
        https://github.com/pgvector/pgvector.git /tmp/pgvector; \
    cd /tmp/pgvector; \
    # OPTFLAGS を空にしてポータブルビルドにする。既定の -march=native は
    # ビルドマシン（CI ランナー等）の CPU 命令セットに最適化されるため、
    # 配布イメージを古い CPU（GCE e2 等）で実行すると SIGILL でクラッシュする。
    make OPTFLAGS=""; \
    make install; \
    # ⚠️ JIT ビットコードが実際に入ったことを確認する。
    # ここを見ないと、生成されていなくてもビルドは成功し、
    # **性能だけが静かに落ちた状態で出荷される**
    test -d "$(pg_config --pkglibdir)/bitcode/vector"; \
    cd /; \
    rm -rf /tmp/pgvector; \
    apk del .pgvector-build-deps

# 初期化SQL（pgroonga / pgvector 拡張の有効化）をイメージに同梱する。
# ホスト側ファイルのバインドマウント前提だと、リポジトリを clone しない
# クイックスタート（compose + .env のみ取得）で初期化に失敗するため。
COPY pgroonga-init.sql /docker-entrypoint-initdb.d/01-pgroonga.sql
