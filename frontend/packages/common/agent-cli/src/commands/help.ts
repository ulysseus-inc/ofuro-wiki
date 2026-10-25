import FORMAT from '../format.md';
import type { Args } from './args';

const USAGE = `ofuro — ofuro-wiki を読み書きする CLI

  ofuro login                                     対話でログイン設定を保存
  ofuro list    [--json] [--tag <名前>]... [--folder <フォルダ>]  ページ一覧（ゴミ箱を除く）
  ofuro search  <keyword> [--limit 10] [--tag <名前>]...  全文検索
  ofuro read    <docId> [--json]                  ページを読む
  ofuro create  [--title <t>] (--file <md> | --stdin) [--tag <名前>]... [--folder <フォルダ>]...
  ofuro edit    <docId> (--ops <json> | --stdin) [--dry-run]
  ofuro update  <docId> (--file <md> | --stdin) [--title <t>] (--dry-run | --base <版>)
  ofuro tags    [--json]                          タグの一覧（付いているページ数）
  ofuro tag     <docId> [--add <名前>]... [--remove <名前>]...
  ofuro image   get <docId> [<ブロックID>]... [--out <ディレクトリ>]  画像・添付を保存
  ofuro image   add <docId> --file <画像> [--after <ID> | --before <ID> | --parent <ID>] [--caption <文>] [--dry-run]
  ofuro folders [--json]                          フォルダのツリー
  ofuro folder  create <名前> [--parent <フォルダ>]
  ofuro folder  (add | remove) <フォルダ> <docId>
  ofuro trash   <docId>                           ゴミ箱へ移す
  ofuro restore <docId>                           ゴミ箱から戻す
  ofuro purge   <docId> --permanent               完全に削除（取り消せない）
  ofuro help    [command | format]

<docId> にはページの URL も渡せる。

共通: --workspace <名前|ID>   対象のワークスペースを絞る（create で候補が複数のときは必須）
      --url <サーバーURL>       設定の URL を上書き（別サーバーにはパスワードを送らない）

設定: 環境変数 OFURO_URL / OFURO_EMAIL / OFURO_PASSWORD（3つ揃える）
      または ~/.ofuro-wiki/config.json（ofuro login が作る）
      ワークスペースは設定しない。招待されたものを自動で使う`;

const COMMANDS: Record<string, string> = {
  edit: '編集操作の書式は ofuro help format を参照。送信前に --dry-run で差分を確かめる。',
  create:
    '本文は Markdown。--title を省くと先頭の # 見出しを題にする（本文からは除く）。--tag でタグを付ける（無い名前は作る）。--folder でフォルダに入れる。ページの URL と docId を出力する。',
  update:
    'Markdown とページを比べ、変わったブロックだけを差し替える（変わらないブロックは ID・書式を保つ）。先に --dry-run で差分と base を出し、利用者の承認後に --base <base> を付けて送る。編集不可のブロック（画像・マルチカラム・データベース等）を含むページは扱えない（edit を使う）。--title と先頭の # 見出しの扱いは create と同じ。見出しも --title も無ければ題は変えない。',
  tag: 'ページのタグを付ける・外す。--add / --remove は繰り返せる。無い名前を --add すると新しいタグを作る（ブラウザと同じ）。--remove に無い名前はエラー。同じ名前のタグが複数あれば ID で指定する。',
  tags: 'タグの名前と、付いているページ数（ゴミ箱を除く）。list / search の --tag は、指定したタグをすべて持つページに絞る。',
  image:
    'add はローカルの画像（PNG / JPEG / GIF / WebP。SVG は不可。50 MB まで）をページに足す。位置は edit の insert と同じ（省くと末尾）。--dry-run で差分を確かめてから送る。create / update / edit の Markdown の ![説明](./a.png) も画像になる（相対パスは --file の Markdown の場所が基準）。画像の差し替えは edit の delete ＋ image。get はページ内の画像・添付ファイルを保存し、保存先のパスを出す。ブロック ID を省くとページ内の全部。保存先の既定は一時ディレクトリ（実行ごとに新しく作る）。読み終えたらディレクトリごと消す。1ファイル 50 MB まで。',
  folder:
    'create はフォルダを作る（入れ子は --parent）。add / remove はページをフォルダに入れる・外す（ページは消えない。1ページを複数のフォルダに入れられる）。フォルダは名前か ID で指す。同じ名前が複数あれば ID を使う。フォルダの削除・名前変更・移動はブラウザで行う。',
  folders:
    'フォルダのツリーと、中のページ（題と docId）。権限の無いページ・ゴミ箱のページは出さない。list --folder はそのフォルダの直下のページに絞る。',
  purge: 'ゴミ箱にあるページだけが対象。取り消せないため --permanent が必須。',
};

/** `ofuro help [command | format]`。format は ofuro-wiki-format/SKILL.md と同じ内容 */
export function help(args: Args): string {
  const topic = args.positionals[0];
  if (topic === 'format') {
    return FORMAT;
  }
  const detail = topic ? COMMANDS[topic] : undefined;
  return detail ? `${USAGE}\n\n${topic}: ${detail}` : USAGE;
}
