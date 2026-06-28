# Third-Party Licenses

本ファイルは ofuro-wiki が利用する第三者オープンソース依存のライセンス監査結果をまとめたものです。
詳細な全量は `THIRD-PARTY-frontend.csv` / `THIRD-PARTY-backend.csv` を参照してください。

- 監査ツール: `license-checker`
- 監査日: 2026-06-27
- 監査対象: frontend（yarn workspaces 全依存ツリー）/ backend（`--production` 依存）
- 自社の private workspace パッケージ（`@ofuro/*`, `@ofuro-tools/*` 等）は集計から除外（`--excludePrivatePackages`）。これらはリポジトリルートの MIT ライセンスが適用される。

## 結論

- **GPL / AGPL の混入はゼロ**（強コピーレフトなし）。
- 第三者依存に UNKNOWN / 未宣言ライセンスは**ゼロ**（旧 `y-provider`（UNKNOWN）は `@blocksuite/playground` 除去により解消済み）。
- コピーレフト系は **MPL-2.0（ファイル単位）** と **LGPL-3.0（libvips・動的ネイティブ）** のみで、いずれも自社コードの開示義務を生じない。

## frontend ライセンス内訳（private 除外）

| License | 件数 |
|---|---|
| MIT | 1319 |
| ISC | 89 |
| Apache-2.0 | 76 |
| BSD-3-Clause | 40 |
| BSD-2-Clause | 27 |
| BlueOak-1.0.0 | 11 |
| MPL-2.0 | 5 |
| CC0-1.0 | 3 |
| MIT* | 3 |
| 0BSD | 3 |
| FSL-1.1-MIT | 2 |
| (MIT OR CC0-1.0) | 2 |
| LGPL-3.0-or-later | 1 |
| Apache-2.0 AND MIT | 1 |
| Custom: MPL-2.0 (URL表記) | 1 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| BSD* | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MIT AND Zlib) | 1 |
| (MIT OR Apache-2.0) | 1 |
| Unlicense | 1 |

## backend ライセンス内訳

全パーミッシブ（MIT / Apache-2.0 / ISC / BSD 系 / BlueOak / 0BSD / Python-2.0 / CC-BY）。
**GPL / AGPL / LGPL / MPL はゼロ。**

## 要注意ライセンスの個別判断

| パッケージ | ライセンス | 判断 |
|---|---|---|
| `jszip` | (MIT OR GPL-3.0-or-later) | **MIT を選択**。GPL は採用しない。 |
| `dompurify` | (MPL-2.0 OR Apache-2.0) | **Apache-2.0 を選択**（パーミッシブ）。未改変利用。 |
| `@toeverything/pdf-viewer` / `@toeverything/pdf-viewer-types` / `@toeverything/pdfium` / `@toeverything/theme` / `lightningcss`(+`lightningcss-linux-x64-gnu`) | MPL-2.0 | 未改変利用のため自社コード開示義務なし。改変した場合のみ当該ファイルを MPL で開示。 |
| `@img/sharp-libvips-linux-x64`（libvips） | LGPL-3.0-or-later | 動的リンクのネイティブライブラリ。差し替え可能。帰属で配布可（強コピーレフトではない）。 |
| `@sentry/cli` / `@sentry/cli-linux-x64` | FSL-1.1-MIT（非OSS・2年後MIT） | **ビルド時ツール（transitive）**。実行時・配布物に含めない方針（T5で実測検証）。 |
| `argparse` | Python-2.0 | パーミッシブ。要帰属のみ。 |
| `caniuse-lite` | CC-BY-4.0 | パーミッシブ。要帰属のみ。 |

## ランタイム外部送信に関する注記（→ T5 で実測検証）

- `@sentry/react`（^9.47.1）は frontend の runtime dependency として宣言されているが、
  ofuro-wiki は `sentry.init()` を呼び出さず、DSN も設定しないため**送信は行われない**。
  この主張は T5（エンドツーエンド実測）で証跡化する。
