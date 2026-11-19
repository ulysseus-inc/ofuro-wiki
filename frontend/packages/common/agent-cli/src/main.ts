import { Session } from './domain/session';
import { CliError } from './errors';
import { exitAfterFlush } from './exit';
import { type Args, option, parseArgs } from './commands/args';
import { help } from './commands/help';
import { login } from './commands/login';
import { create, edit, list, read, search, update } from './commands/pages';
import { folder, folders } from './commands/folders';
import { image } from './commands/image';
import { tag, tags } from './commands/tags';
import { purge, restore, trash } from './commands/trash';

enum ExitCode {
  Ok = 0,
  Failed = 1,
  Usage = 2,
}

type Command = (session: Session, args: Args) => Promise<string>;

const COMMANDS: Record<string, Command> = {
  list,
  search,
  read,
  create,
  edit,
  update,
  tags,
  tag,
  folders,
  folder,
  image,
  trash,
  restore,
  purge,
};

/**
 * エントリポイント。
 *
 * ⚠️ 最後に必ず exitAfterFlush で終える（exit.ts。出力を送り切ってから exit する）。
 */
async function main(argv: string[]): Promise<ExitCode> {
  const [name, ...rest] = argv;
  const args = parseArgs(rest);

  if (!name || name === 'help' || args.options.has('help')) {
    process.stdout.write(`${help(args)}\n`);
    return ExitCode.Ok;
  }
  if (name === 'login') {
    process.stdout.write(`${await login(args)}\n`);
    return ExitCode.Ok;
  }

  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`不明なコマンド: ${name} → ofuro help で一覧を見る\n`);
    return ExitCode.Usage;
  }

  const session = Session.open(option(args, 'url'), option(args, 'workspace'));
  try {
    process.stdout.write(`${await command(session, args)}\n`);
    return ExitCode.Ok;
  } finally {
    session.close();
  }
}

main(process.argv.slice(2))
  .then(code => exitAfterFlush(code))
  .catch((e: unknown) => {
    const line =
      e instanceof CliError ? e.toLine() : `想定外のエラー: ${String(e)}`;
    process.stderr.write(`${line}\n`);
    exitAfterFlush(ExitCode.Failed);
  });
