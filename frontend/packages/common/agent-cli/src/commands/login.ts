import readline from 'node:readline';

import { Session } from '../domain/session';
import { CliError } from '../errors';
import { type Args, option } from './args';

/**
 * `ofuro login`。対話で URL・メール・パスワードを聞いてサインインし、
 * URL・メールとトークンを保存する（600）。**パスワードは保存しない**（設計書 §4）。
 *
 * ⚠️ パスワードをチャットに貼らせないための入口（設計書 §4）。
 * 入力は画面に出さない。
 */
export async function login(args: Args): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      'ofuro login は端末から対話で実行する',
      '利用者自身が端末で実行するか、環境変数 OFURO_URL / OFURO_EMAIL / OFURO_PASSWORD を使う'
    );
  }

  // ブラウザのアドレスをそのまま貼られてもよい。サーバーの部分だけを保存する
  const url = Session.serverOf(
    option(args, 'url') ?? (await ask('サーバー URL: '))
  );
  const email = await ask('メールアドレス: ');
  const password = await ask('パスワード: ', Echo.Hidden);

  // 入力した値そのもので sign-in して確かめてから保存する。キャッシュの
  // トークンや環境変数で確かめると、誤ったパスワードでも「ログインした」になる。
  // 別アカウントの誤作成もここで分かる（招待されたワークスペースが無い）
  const spaces = await Session.verifyLogin({ url, email, password });
  const file = Session.saveLogin({ url, email });
  return [
    `ログインした: ${email}（使えるワークスペース: ${spaces.map(s => s.name).join(' / ')}）`,
    `設定: ${file}`,
  ].join('\n');
}

export enum Echo {
  Visible,
  Hidden,
}

function ask(question: string, echo = Echo.Visible): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // 入力した文字を表示しない。プロンプトだけは出す
  if (echo === Echo.Hidden) {
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    output._writeToOutput = (s: string) => {
      if (s.startsWith(question)) {
        process.stdout.write(question);
      }
    };
  }

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      if (echo === Echo.Hidden) {
        process.stdout.write('\n');
      }
      resolve(cleanAnswer(answer, echo));
    });
  });
}

/** パスワードは前後の空白も含めて本人が決めた値。削ると必ず 401 になる */
export function cleanAnswer(answer: string, echo: Echo): string {
  return echo === Echo.Hidden ? answer : answer.trim();
}
