/**
 * 利用者（AI）に返すエラー。
 *
 * 「何が起きたか・次に何をすべきか」を1行で出す（設計書 §8）。
 * 例: `存在しないか権限が無い: abc → ofuro list で docId を確かめる`
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(message);
  }

  toLine(): string {
    if (!this.hint) {
      return this.message;
    }
    return `${this.message} → ${this.hint}`;
  }
}

/** 権限不足と不在はサーバーが区別させない。文言も分けない */
export function notFound(docId: string): CliError {
  return new CliError(
    `存在しないか権限が無い: ${docId}`,
    'ofuro list か ofuro search で docId を確かめる'
  );
}
