import { CliError } from '../errors';

/**
 * 最小限の引数解析。
 *
 * 例: `edit abc --ops '[...]' --dry-run`
 *   → positionals: ['abc'], options: { ops: '[...]', 'dry-run': true }
 */
export interface Args {
  positionals: string[];
  options: Map<string, string | true>;
  /** 値を取るオプションの全部の値。例: `--tag a --tag b` → `tag: ['a', 'b']` */
  lists: Map<string, string[]>;
}

/** 値を取らないオプション */
const FLAGS = new Set(['json', 'dry-run', 'stdin', 'permanent', 'help']);

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  const lists = new Map<string, string[]>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (FLAGS.has(name)) {
      options.set(name, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliError(`--${name} に値が無い`);
    }
    options.set(name, value);
    lists.set(name, [...(lists.get(name) ?? []), value]);
    i++;
  }
  return { positionals, options, lists };
}

export function option(args: Args, name: string): string | undefined {
  const value = args.options.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** 繰り返し指定できるオプション。例: `--tag a --tag b` → `['a', 'b']` */
export function options(args: Args, name: string): string[] {
  return args.lists.get(name) ?? [];
}

export function flag(args: Args, name: string): boolean {
  return args.options.get(name) === true;
}

export function requirePositional(
  args: Args,
  index: number,
  label: string
): string {
  const value = args.positionals[index];
  if (!value) {
    throw new CliError(`${label}が無い`, 'ofuro help で使い方を確かめる');
  }
  return value;
}
