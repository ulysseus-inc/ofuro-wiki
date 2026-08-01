import {
  parseUserCsv,
  CsvFormatError,
  CSV_MAX_ROWS,
} from '../../../src/modules/admin/user-csv.util';

describe('parseUserCsv (#92)', () => {
  it('ヘッダーに従って列を読む', () => {
    const rows = parseUserCsv(
      'email,name,password\na@example.com,山田 太郎,Pass1234!\n',
    );
    expect(rows).toEqual([
      { line: 2, email: 'a@example.com', name: '山田 太郎', password: 'Pass1234!' },
    ]);
  });

  // 列順を固定にすると、Excel で並べ替えた CSV が黙って壊れる
  it('列の順序が違っても読める', () => {
    const rows = parseUserCsv(
      'password,email,name\nPass1234!,a@example.com,太郎\n',
    );
    expect(rows[0]).toMatchObject({
      email: 'a@example.com',
      name: '太郎',
      password: 'Pass1234!',
    });
  });

  // Excel が付ける BOM を残すと、ヘッダー名が "﻿email" になり列を見失う
  it('BOM 付きでも email 列を見つけられる', () => {
    const rows = parseUserCsv(
      '﻿email,password\na@example.com,Pass1234!\n',
    );
    expect(rows[0].email).toBe('a@example.com');
  });

  it('CRLF 改行を扱える', () => {
    const rows = parseUserCsv(
      'email,password\r\na@example.com,Pass1234!\r\nb@example.com,Pass1234!\r\n',
    );
    expect(rows.map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  // 氏名に「山田, 太郎」のような値が入りうる
  it('引用符で囲んだカンマを値として読む', () => {
    const rows = parseUserCsv(
      'email,name,password\na@example.com,"山田, 太郎",Pass1234!\n',
    );
    expect(rows[0].name).toBe('山田, 太郎');
  });

  // 行番号は「CSV を直すための情報」なので、ずれた番号は無いより悪い。
  // 値の中の改行と行番号を別々に検証すると、このずれを見逃す。
  it('引用符内に改行があっても、以降の行番号が実ファイルとずれない', () => {
    const rows = parseUserCsv(
      'email,name,password\na@example.com,"山田\n太郎",Pass1234!\nb@example.com,花子,Pass1234!\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('山田\n太郎');
    // 2行目から始まり、値の中の改行で1行進むため、次のレコードは4行目
    expect(rows[0].line).toBe(2);
    expect(rows[1].email).toBe('b@example.com');
    expect(rows[1].line).toBe(4);
  });

  it('改行を2つ含む値でも行番号が追従する', () => {
    const rows = parseUserCsv(
      'email,name,password\na@example.com,"1\n2\n3",Pass1234!\nb@example.com,花子,Pass1234!\n',
    );
    expect(rows[1].line).toBe(5);
  });

  it('"" は引用符そのものとして読む', () => {
    const rows = parseUserCsv(
      'email,name,password\na@example.com,"太郎 ""たろ""",Pass1234!\n',
    );
    expect(rows[0].name).toBe('太郎 "たろ"');
  });

  // 末尾の改行や Excel が残す空行で NG を出さない
  it('空行は読み飛ばす', () => {
    const rows = parseUserCsv(
      'email,password\n\na@example.com,Pass1234!\n\n\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe(3);
  });

  // trim すると CSV に書いた値と実際のパスワードが食い違う
  it('パスワードの前後の空白を削らない（検証側で NG にする）', () => {
    const rows = parseUserCsv(
      'email,name,password\na@example.com,太郎, Pass1234! \n',
    );
    expect(rows[0].password).toBe(' Pass1234! ');
  });

  it('メールアドレスと氏名の前後の空白は削る', () => {
    const rows = parseUserCsv(
      'email,name,password\n a@example.com , 太郎 ,Pass1234!\n',
    );
    expect(rows[0].email).toBe('a@example.com');
    expect(rows[0].name).toBe('太郎');
  });

  it('列が足りない行は空文字として読む（検証側で NG にする）', () => {
    const rows = parseUserCsv('email,name,password\na@example.com\n');
    expect(rows[0]).toMatchObject({ name: '', password: '' });
  });

  it('行番号はヘッダーを1として数える', () => {
    const rows = parseUserCsv(
      'email,password\na@example.com,Pass1234!\nb@example.com,Pass1234!\n',
    );
    expect(rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it('email 列が無ければエラー', () => {
    expect(() => parseUserCsv('mail,password\na@example.com,Pass1234!')).toThrow(
      CsvFormatError,
    );
  });

  it('空の CSV はエラー', () => {
    expect(() => parseUserCsv('\n\n')).toThrow(CsvFormatError);
  });

  it(`${CSV_MAX_ROWS} 行を超えるとエラー`, () => {
    const body = Array.from(
      { length: CSV_MAX_ROWS + 1 },
      (_, i) => `user${i}@example.com,Pass1234!`,
    ).join('\n');
    expect(() => parseUserCsv(`email,password\n${body}`)).toThrow(
      CsvFormatError,
    );
  });

  it(`${CSV_MAX_ROWS} 行ちょうどは通る`, () => {
    const body = Array.from(
      { length: CSV_MAX_ROWS },
      (_, i) => `user${i}@example.com,Pass1234!`,
    ).join('\n');
    expect(parseUserCsv(`email,password\n${body}`)).toHaveLength(CSV_MAX_ROWS);
  });
});
