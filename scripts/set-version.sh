#!/usr/bin/env bash
# ofuro-wiki のリリースバージョンを設定する（#87）
#
# 使い方:
#   bash scripts/set-version.sh 0.1.0
#
# バージョンの「正」は Git タグ（vX.Y.Z）である。
# 本スクリプトは、タグと突き合わせるべきファイル側の版数を書き換えるだけで、
# タグは打たない（打ち間違いを取り返せなくするため、タグは手動で打つ）。
#
# 書き換え対象:
#   - frontend/package.json … UI（設定→About）に表示される版数
#   - backend/package.json  … 内部管理用
#
# 書き換えないもの:
#   - backend/src/modules/config/config.service.ts の AFFINE_API_VERSION
#     → フロントとの通信プロトコル互換用であり、製品バージョンではない
#   - Docker の APP_VERSION
#     → CI がタグから --build-arg VERSION として渡す
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "使い方: bash scripts/set-version.sh <X.Y.Z>" >&2
  echo "例:     bash scripts/set-version.sh 0.1.0" >&2
  exit 1
fi

# "v0.1.0" と書かれても受け付ける
VERSION="${VERSION#v}"

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "エラー: バージョンは X.Y.Z 形式で指定してください（例: 0.1.0 / 0.1.0-rc.1）" >&2
  echo "        指定された値: $VERSION" >&2
  exit 1
fi

set_pkg_version() {
  local file="$1"
  local before
  before="$(node -p "require('./${file}').version")"

  node -e '
    const fs = require("fs");
    const [file, version] = process.argv.slice(1);
    const raw = fs.readFileSync(file, "utf8");
    // 先頭の "version" フィールドのみを置換する（依存パッケージの version には触れない）
    const replaced = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
    if (replaced === raw) {
      console.error(`エラー: ${file} の version フィールドを書き換えられませんでした`);
      process.exit(1);
    }
    fs.writeFileSync(file, replaced);
  ' "$file" "$VERSION"

  echo "  ${file}: ${before} -> ${VERSION}"
}

echo "==> バージョンを ${VERSION} に設定します"
set_pkg_version "frontend/package.json"
set_pkg_version "backend/package.json"

cat <<EOF

==> 完了。次の手順:

  1. 差分を確認
       git diff

  2. コミット → PR → master へマージ
       git add frontend/package.json backend/package.json
       git commit -m "chore: バージョンを ${VERSION} に更新"

  3. master でタグを打つ（ここで初めてバージョンが確定する）
       git tag v${VERSION}
       git push origin v${VERSION}

     → CI がイメージ :${VERSION} と :latest をビルドし、
       APP_VERSION=${VERSION} を焼き込む

  4. OSS リポジトリへ反映し、公開側でもタグと Release を作成
       bash scripts/oss-publish.sh --push
       # OSS クローン側で git tag v${VERSION} && git push origin v${VERSION}
       # GitHub で Release を作成し、変更点を記載する
EOF
