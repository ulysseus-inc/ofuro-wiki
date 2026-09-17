#!/usr/bin/env node
/**
 * #125: フロントエンドの型エラー件数が**増えていないか**を検査する。
 *
 * ## ⚠️ なぜ「ゼロ」ではなく「基準値」なのか
 *
 * 既知の未修正が 107 件ある（大半はフォーク元 AFFiNE 由来）。
 * （113 → 111: #204 で死にコードを消したとき、既存の型エラーも2件消えた）
 * （111 → 107: #210 で schema.ts を生成物にし、手書きの型と実装のずれが4件解消した）
 * ゼロを条件にすると CI が常に赤になり、**誰も見なくなる**。
 * まず「増やさない」ことを守り、減らしたら基準値を下げていく。
 *
 * ## 使い方
 *
 *   yarn typecheck:ci
 *
 * 基準値を下げるときは `TYPECHECK_BASELINE` を書き換える。
 * ⚠️ **増やす方向に書き換えないこと。** それは検査を無効化するのと同じ。
 */
import { spawnSync } from 'node:child_process';

/** 既知の未修正件数。**これを上回ったら失敗させる。** */
const TYPECHECK_BASELINE = 107;

/**
 * tsc --build の終了コード。
 *
 * ⚠️ **0 と 2 以外は「型検査が成立しなかった」とみなす。**
 * ここを見ないと、tsc が OOM や設定不備で落ちたときに
 * エラー行が 0 件になり、**「基準値を下回った」と誤判定して CI が緑になる**。
 * 型検査が一度も走っていないのに通る、という最悪の壊れ方をする。
 */
const TSC_EXIT_NO_ERRORS = 0;
const TSC_EXIT_TYPE_ERRORS = 2;

// ⚠️ **--force を付ける。** tsc --build は増分のため、.tsbuildinfo が残っている
// 2回目以降は変更のないプロジェクトを飛ばし、**そのエラーを再出力しない**。
// 付けないとローカルで件数が過小になり、「減った、基準値を下げろ」と誤って促す。
const result = spawnSync(
  'npx',
  [
    'tsc',
    '--build',
    '--force',
    'packages/frontend/apps/web/tsconfig.json',
    'packages/frontend/apps/mobile/tsconfig.json',
  ],
  { encoding: 'utf8', shell: false }
);

if (result.error) {
  console.error(`\n❌ tsc を起動できませんでした: ${result.error.message}\n`);
  process.exit(1);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
console.log(output);

if (
  result.status !== TSC_EXIT_NO_ERRORS &&
  result.status !== TSC_EXIT_TYPE_ERRORS
) {
  console.error(
    `\n❌ 型検査が成立しませんでした（tsc の終了コード: ${result.status}）。\n` +
      `\nエラー件数では判定できません。上の出力を確認してください。\n` +
      `よくある原因: メモリ不足、tsconfig の指定誤り、依存の未導入。\n`
  );
  process.exit(1);
}

const errors = output.split('\n').filter(l => / error TS\d+: /.test(l));
const count = errors.length;

// 終了コードが 2（型エラーあり）なのに 1 件も拾えないのは、出力形式が
// 変わったなどで**数えられていない**ということ。見逃すより落とす。
if (result.status === TSC_EXIT_TYPE_ERRORS && count === 0) {
  console.error(
    '\n❌ tsc は型エラーありで終了しましたが、エラー行を数えられませんでした。\n' +
      'このスクリプトの解析が実態と合っていません。\n'
  );
  process.exit(1);
}

console.log('='.repeat(60));
console.log(`型エラー: ${count} 件 / 基準値: ${TYPECHECK_BASELINE} 件`);

if (count > TYPECHECK_BASELINE) {
  console.error(
    `\n❌ 型エラーが ${count - TYPECHECK_BASELINE} 件増えています。\n` +
      `\n増えた分を修正してください。基準値を引き上げて通すことはしないでください。\n` +
      `（基準値は frontend/scripts/check-typecheck-baseline.mjs の TYPECHECK_BASELINE）\n`
  );
  process.exit(1);
}

if (count < TYPECHECK_BASELINE) {
  console.log(
    `\n✅ 型エラーが ${TYPECHECK_BASELINE - count} 件減りました。\n` +
      `TYPECHECK_BASELINE を ${count} に更新してください（減った分を固定するため）。\n`
  );
}

console.log('\n✅ 型エラーは増えていません。');
