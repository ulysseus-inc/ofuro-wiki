# 開発用 Keycloak（#89 シングルサインオンの検証）

シングルサインオン（OIDC）を**外部サービスなしで**検証するための IdP です。
`profiles: [dev]` のため、通常の `docker compose up` では起動しません。

## 起動

```bash
docker compose --profile dev up -d keycloak
```

- 管理コンソール: http://localhost:8081 （`admin` / `admin`）
- 起動時に `realm-export.json` が読み込まれ、realm・クライアント・テストユーザーが作られます

## ofuro-wiki 側の設定

管理画面 →「シングルサインオン（OIDC）」に以下を入力します。

| 項目 | 値 |
|------|-----|
| 発行者URL (Issuer) | `http://localhost:8081/realms/ofuro` |
| クライアントID | `ofuro-wiki` |
| クライアントシークレット | `dev-client-secret` |
| ボタン表示名 | `Keycloak でサインイン` |

> リダイレクト URI（`http://localhost:8080/oauth/callback`）は realm 定義に登録済みです。

## テストユーザー

| メールアドレス | パスワード |
|------|-----|
| `sso-user@example.invalid` | `SsoTestPass123!` |

⚠️ **開発専用**です。クライアントシークレットもテストユーザーのパスワードも
このファイルに平文で書かれています。本番環境では使わないでください。
