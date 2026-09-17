# バージョンの体系（#234）

**版数は5種類ある。混ぜると事故る。** この文書が唯一の正とする。

## 1. 一覧

| 何の版数 | いまの値 | 出どころ | 誰が上げるか |
|---|---|---|---|
| **製品**（唯一の正） | `v0.1.0` | **Git タグ** | リリース時に手で打つ |
| UI 表示（PC・スマホ共通） | `0.1.0-dev` | `frontend/package.json` → `BUILD_CONFIG.productVersion` | `scripts/set-version.sh` |
| バックエンド（内部管理） | `0.1.0-dev` | `backend/package.json` | 同上 |
| 実行中のイメージ | `0.0.0-dev+ad0fadc` | `APP_VERSION`（環境変数） | **CI が焼き込む** |
| 通信プロトコル | `0.26.1` | `BUILD_CONFIG.appVersion` / `AFFINE_API_VERSION` | **上流追従のときだけ** |
| エディタ | BlockSuite の版数 | `frontend/blocksuite/affine/all/package.json` | 上流更新時 |

⚠️ **Web とスマホは同じ版数。** どちらも `frontend/package.json` を見る。
アプリのパッケージ（`apps/web` / `apps/mobile`）の `version` は `0.26.1` のままで、
これは**上流 AFFiNE の版数**。リリースしても動かない。

## 2. ⚠️ `appVersion` は、前と後ろで別物

**同じ名前で違うものを指す。** ここが一番の落とし穴。

| どこ | `appVersion` の中身 |
|---|---|
| フロントエンド（`BUILD_CONFIG.appVersion`） | **通信プロトコル**の版数（`0.26.1`）。`x-affine-version` ヘッダーと同期の `clientVersion` に使う |
| バックエンド（`serverConfig.appVersion`） | **製品**の版数（`APP_VERSION`。例 `0.1.0`） |

だから画面に製品版数を出すときは **`productVersion`** を使う（#105 で分離した）。
`BUILD_CONFIG.appVersion` を製品版数のつもりで上げると、**通信の名乗りまで動く**。

## 3. 触ってはいけないもの

- **`AFFINE_API_VERSION`**（`backend/src/modules/config/config.service.ts`）
  → 上流 AFFiNE との互換用。フロントを上流に追従させたときだけ変える
- **`BUILD_CONFIG.appVersion`**（= `apps/*/package.json` の `version`）
  → 同上
- **BlockSuite の版数**
  → 上流が決めるもの

## 4. リリースのときに何が起きるか

```
  1. scripts/set-version.sh 0.1.0
        frontend/package.json  0.1.0-dev → 0.1.0   ← 画面の表示
        backend/package.json   0.1.0-dev → 0.1.0
        （タグは打たない。打ち間違いを取り返せなくするため）

  2. コミット → PR → master

  3. git tag v0.1.0 && git push origin v0.1.0    ← ここで確定

  4. CI（.github/workflows/build-push.yml）
        タグ push      → APP_VERSION=0.1.0、イメージに :0.1.0 / :0.1.0 系 / :latest
        ブランチ push  → APP_VERSION=0.0.0-dev+<コミット7桁>
```

⚠️ **タグを打たずに master へ入れたものは、ずっと `0.0.0-dev+<コミット>`。**
これは欠陥ではなく、そう決めている。おかげで**動いているイメージの出どころが1コミットまで絞れる**。

## 5. 動いているものの版数を確かめる

```bash
curl -s https://<ホスト>/graphql -H 'content-type: application/json' \
  -d '{"query":"{ serverConfig { name version appVersion } }"}'
```

```json
{"data":{"serverConfig":{"name":"ofuro-wiki","version":"0.26.1","appVersion":"0.0.0-dev+ad0fadc"}}}
```

- `version` … 通信プロトコル（上流 AFFiNE の版数）
- `appVersion` … 製品の版数。`0.0.0-dev+<コミット>` ならタグ未取得のビルド

画面からは **設定 → 情報**（PC・スマホとも）で、製品版数とエディタの版数を見られる。
ここに出るのは**ビルド時に焼き込んだ `productVersion`** であり、
サーバーの `appVersion` ではない。**両者がずれることがある**
（フロントは `frontend/package.json`、サーバーはタグ由来のため）。

## 6. 関連

この文書は**体系**（どの版数が何を指すか）を定める。
**手順**（リリースのときに何をどの順で実行するか）は別に置いてある。

- `scripts/set-version.sh` … 2つの `package.json` を書き換えるだけ
- `.github/workflows/build-push.yml` … `APP_VERSION` の決定とイメージのタグ付け
- リリースの実施手順は、メンテナ向けの手順書にまとめてある（公開していない）
