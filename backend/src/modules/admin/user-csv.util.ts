/**
 * #92: ユーザー一括登録用の CSV 解析。
 *
 * 外部ライブラリを足さずに済む範囲の実装。引用符・カンマ・改行を含む値に
 * 対応する（氏名に「山田, 太郎」のような値が入りうるため）。
 */

/** 1回あたりの上限。bcrypt のハッシュ化を件数分行うため、無制限にはしない。 */
export const CSV_MAX_ROWS = 500;

export interface ParsedCsvRow {
  /** CSV 上の行番号（ヘッダーを1とする）。利用者に示すため保持する。 */
  line: number;
  email: string;
  name: string;
  password: string;
}

/** 1行分をフィールドに分解する。引用符内のカンマ・二重引用符に対応する。 */
function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        // "" は引用符そのものを表す
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

interface CsvRecord {
  text: string;
  /** ファイル上の物理行番号（1始まり）。利用者に示す番号はこれを使う。 */
  line: number;
}

/**
 * 引用符内の改行を考慮してレコードに分割する。
 * 単純な split('\n') だと、値の中の改行で行がずれる。
 *
 * ⚠️ 論理的なレコードの並び順ではなく、**ファイル上の物理行番号**を持たせる。
 * 引用符内に改行を含む値が1つでもあると両者はずれ、
 * 「◯行目が NG」の表示が別の行を指してしまう（Admin が直しようがない）。
 */
function splitRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let current = '';
  let inQuotes = false;
  let physicalLine = 1;
  let startLine = 1;

  const push = () => {
    records.push({ text: current, line: startLine });
    current = '';
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      // 直前が引用符の場合はエスケープなので状態を変えない
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '\n' || char === '\r') {
      // CRLF は1つの改行として扱う
      if (char === '\r' && text[i + 1] === '\n') i++;
      physicalLine++;
      if (inQuotes) {
        // 値の中の改行。レコードは終わらないが、物理行は進む
        current += '\n';
      } else {
        push();
        startLine = physicalLine;
      }
    } else {
      current += char;
    }
  }
  if (current !== '') push();
  return records;
}

export class CsvFormatError extends Error {}

/**
 * CSV 文字列を行の配列にする。
 *
 * ヘッダー行（email / name / password）で列位置を決めるため、列の順序は問わない。
 * 空行は読み飛ばす（末尾の改行や、Excel が残す空行で NG を出さないため）。
 */
export function parseUserCsv(text: string): ParsedCsvRow[] {
  // Excel が付ける BOM を取り除く。残すとヘッダー名が "﻿email" になり列を見失う。
  const normalized = text.replace(/^﻿/, '');
  const records = splitRecords(normalized);

  const headerIndex = records.findIndex((r) => r.text.trim() !== '');
  if (headerIndex === -1) {
    throw new CsvFormatError('CSV が空です');
  }

  const header = splitFields(records[headerIndex].text).map((h) =>
    h.trim().toLowerCase(),
  );
  const emailAt = header.indexOf('email');
  if (emailAt === -1) {
    throw new CsvFormatError(
      'ヘッダー行に email 列がありません（1行目に email,name,password を書いてください）',
    );
  }
  const nameAt = header.indexOf('name');
  const passwordAt = header.indexOf('password');

  const rows: ParsedCsvRow[] = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    const record = records[i];
    if (record.text.trim() === '') continue;

    const fields = splitFields(record.text);
    const at = (index: number) =>
      index >= 0 && index < fields.length ? fields[index] : '';

    rows.push({
      line: record.line,
      email: at(emailAt).trim(),
      name: at(nameAt).trim(),
      // ⚠️ パスワードは trim しない。前後の空白も値の一部でありうるため、
      // ここで削ると **CSV に書いた値と実際のパスワードが食い違う**。
      // ただし「, 」区切りで意図せず空白が入る CSV もあるため、
      // 前後に空白がある場合は検証で NG にして直してもらう（黙って通さない）。
      password: at(passwordAt),
    });

    if (rows.length > CSV_MAX_ROWS) {
      throw new CsvFormatError(
        `1回に登録できるのは ${CSV_MAX_ROWS} 行までです。分割してください`,
      );
    }
  }

  return rows;
}
