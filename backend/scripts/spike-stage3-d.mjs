/**
 * #151 段階3 D案 最小試作
 *
 * 検証する命題:
 *   「ルート目次(Root YDoc)を完全同期していないクライアントからの metadata 変更を
 *     正本へ merge しても、既存ページ・既存 metadata が消失せず、
 *     変更結果が CRDT として収束すること」
 *
 * 書き込みの意味論は本物に合わせている:
 *   frontend/packages/frontend/core/src/modules/workspace/impls/meta.ts:183 setDocMeta
 *   → createYProxy の set ハンドラ (reactive/proxy.ts:280) → native2Y(value) → yMap.set(key, yData)
 *   ⚠️ 配列は毎回 Y.Array ごと差し替え（要素単位のマージではない）
 *   ⚠️ 対象 id が pages に無ければ「黙って何もしない」(index === -1 → return)
 */
import * as Y from 'yjs';

/** blocksuite の native2Y と同じ形（配列→Y.Array / プレーンオブジェクト→Y.Map） */
function native2Y(value) {
  if (Array.isArray(value)) {
    const arr = new Y.Array();
    arr.push(value.map(native2Y));
    return arr;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Y.AbstractType)) {
    const map = new Y.Map();
    Object.entries(value).forEach(([k, v]) => map.set(k, native2Y(v)));
    return map;
  }
  return value;
}

function getPages(doc) {
  return doc.getMap('meta').get('pages');
}

/** meta.ts:183 setDocMeta の写し。戻り値は「実際に書けたか」 */
function setDocMeta(doc, id, props) {
  const pages = getPages(doc);
  if (!pages) return false; // if (!this.docs) return
  let index = -1;
  for (let i = 0; i < pages.length; i++) {
    if (pages.get(i).get('id') === id) { index = i; break; }
  }
  if (index === -1) return false; // ⚠️ 黙って no-op
  doc.transact(() => {
    const page = pages.get(index);
    Object.entries(props).forEach(([k, v]) => page.set(k, native2Y(v)));
  }, doc.clientID);
  return true;
}

/** D案の実装者が「無いなら作る」と書いた場合の挙動 */
function upsertDocMeta(doc, id, props) {
  const meta = doc.getMap('meta');
  if (!meta.get('pages')) meta.set('pages', new Y.Array());
  const pages = meta.get('pages');
  for (let i = 0; i < pages.length; i++) {
    if (pages.get(i).get('id') === id) {
      doc.transact(() => {
        const page = pages.get(i);
        Object.entries(props).forEach(([k, v]) => page.set(k, native2Y(v)));
      }, doc.clientID);
      return 'updated';
    }
  }
  doc.transact(() => {
    const page = new Y.Map();
    page.set('id', id);
    Object.entries(props).forEach(([k, v]) => page.set(k, native2Y(v)));
    pages.push([page]);
  }, doc.clientID);
  return 'inserted';
}

/** 正本を作る: A(tag=x) と B(tag=y) */
function makeServerDoc() {
  const doc = new Y.Doc();
  const pages = new Y.Array();
  doc.getMap('meta').set('pages', pages);
  doc.transact(() => {
    for (const [id, title, tag] of [['A', 'ページA', 'x'], ['B', 'ページB', 'y']]) {
      const p = new Y.Map();
      p.set('id', id);
      p.set('title', title);
      p.set('tags', native2Y([tag]));
      p.set('trash', false);
      p.set('createDate', 1000);
      pages.push([p]);
    }
  });
  return doc;
}

function dump(doc) {
  const pages = getPages(doc);
  if (!pages) return '(pages なし)';
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages.get(i);
    const tags = p.get('tags');
    out.push({
      id: p.get('id'),
      title: p.get('title'),
      tags: tags instanceof Y.Array ? tags.toArray() : tags,
      trash: p.get('trash'),
    });
  }
  return out;
}

function merge(a, b) {
  // 双方向に更新を適用（正本 ⇄ クライアント）
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}

function converged(a, b) {
  return JSON.stringify(dump(a)) === JSON.stringify(dump(b));
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (detail) console.log(`      ${detail}`);
}

console.log('='.repeat(70));
console.log('シナリオ1: 完全に空のクライアント（D案で目次を一切配らない場合）');
console.log('='.repeat(70));

for (const [label, props, verify] of [
  ['① タグ追加', { tags: ['x', 'z'] }, a => JSON.stringify(a.tags) === JSON.stringify(['x', 'z'])],
  ['② ゴミ箱',   { trash: true },      a => a.trash === true],
  ['③ タイトル', { title: '改名後' },  a => a.title === '改名後'],
]) {
  const server = makeServerDoc();
  const client = new Y.Doc(); // 一度も同期していない
  const wrote = setDocMeta(client, 'A', props);
  merge(server, client);
  const after = dump(server);
  const survived = after.length === 2 && after[0].id === 'A' && after[1].id === 'B';
  // ⚠️ 文字列の包含で判定しない。題に "true" が含まれるだけで通ってしまう
  const applied = verify(after[0]);
  check(
    `${label}: 正本の既存ページが消えない`,
    survived,
    `正本 = ${JSON.stringify(after)}`
  );
  check(
    `${label}: 変更が正本へ届く`,
    applied,
    `setDocMeta の戻り値 = ${wrote}（false なら黙って捨てられた）`
  );
}

console.log();
console.log('='.repeat(70));
console.log('シナリオ2: 空のクライアントが「無いなら作る」で書いた場合');
console.log('='.repeat(70));

for (const [label, props] of [
  ['① タグ追加', { tags: ['x', 'z'] }],
  ['② ゴミ箱',   { trash: true }],
  ['③ タイトル', { title: '改名後' }],
]) {
  const server = makeServerDoc();
  const client = new Y.Doc();
  const how = upsertDocMeta(client, 'A', props);
  merge(server, client);
  const after = dump(server);
  const ids = after.map(p => p.id);
  const noLoss = ids.includes('A') && ids.includes('B');
  const noDup = new Set(ids).size === ids.length;
  check(`${label}: 既存ページが消えない`, noLoss, `id = ${JSON.stringify(ids)}`);
  check(`${label}: 重複エントリが出ない`, noDup, `動作 = ${how} / 正本 = ${JSON.stringify(after)}`);
  check(`${label}: 正本とクライアントが収束`, converged(server, client));
}

console.log();
console.log('='.repeat(70));
console.log('シナリオ3: 完全同期クライアント（対照実験）');
console.log('  Server  A:tag=x  B:tag=y   /   Client  正本を丸ごと持つ');
console.log('  Client → A に tag=z を足す');
console.log('  ⚠️ これは「目次を持っていれば安全」を示す対照であり、部分同期ではない');
console.log('='.repeat(70));

{
  const server = makeServerDoc();
  const client = new Y.Doc();
  // ⚠️ ここは意図的に「完全同期」にしている。
  // 「A だけ持ち B を知らない」状態は、そもそも構成できない:
  //   - B を消して作る   → 削除マーカーが焼き付き、正本から B が消える（1.1 の1行目）
  //   - 最初から作り直す → pages が別実体になり、目次全体が入れ替わる（シナリオ2・5）
  // 「部分的なルート YDoc」という状態が作れないこと自体が、D 案が不成立である理由。
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const cur = dump(client).find(p => p.id === 'A').tags;
  setDocMeta(client, 'A', { tags: [...cur, 'z'] });
  merge(server, client);
  const after = dump(server);
  const a = after.find(p => p.id === 'A');
  const b = after.find(p => p.id === 'B');
  check('A のタグが x,z になる', JSON.stringify(a?.tags) === JSON.stringify(['x', 'z']), `A = ${JSON.stringify(a)}`);
  check('B が消えず tag=y を保つ', JSON.stringify(b?.tags) === JSON.stringify(['y']), `B = ${JSON.stringify(b)}`);
  check('正本とクライアントが収束', converged(server, client));
}

console.log();
console.log('='.repeat(70));
console.log('シナリオ4: タグの同時変更（配列まるごと差し替えの影響）');
console.log('  2人が同じページのタグを同時に変える');
console.log('='.repeat(70));

{
  const server = makeServerDoc();
  const c1 = new Y.Doc();
  const c2 = new Y.Doc();
  Y.applyUpdate(c1, Y.encodeStateAsUpdate(server));
  Y.applyUpdate(c2, Y.encodeStateAsUpdate(server));
  setDocMeta(c1, 'A', { tags: ['x', 'z'] });   // 人1が z を足す
  setDocMeta(c2, 'A', { tags: ['x', 'w'] });   // 人2が w を足す
  merge(server, c1);
  merge(server, c2);
  merge(server, c1);
  const a = dump(server).find(p => p.id === 'A');
  check('両方のタグが残る（z と w）',
    a.tags.includes('z') && a.tags.includes('w'),
    `A のタグ = ${JSON.stringify(a.tags)}`);
  check('3者が収束', converged(server, c1) && converged(server, c2));
}


// ---------------------------------------------------------------------------
// 追試: シナリオ2の異常は「両者が別々の Y.Array を meta.pages に作る」ため。
// Y.Map のキー競合は last-writer-wins で、配列ごと片方が捨てられる。
// 勝敗は clientID の大小で決まり、内容とは無関係。
// ---------------------------------------------------------------------------
console.log();
console.log('='.repeat(70));
console.log('シナリオ5: pages Y.Array の identity 競合（100回試行）');
console.log('='.repeat(70));
{
  let serverWins = 0, clientWins = 0;
  for (let i = 0; i < 100; i++) {
    const server = makeServerDoc();
    const client = new Y.Doc();
    upsertDocMeta(client, 'A', { trash: true });
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
    const ids = dump(server).map(p => p.id);
    ids.length === 2 ? serverWins++ : clientWins++;
  }
  console.log(`正本の配列が残った                          : ${serverWins} 回`);
  console.log(`クライアントの配列に置き換わった（他ページ消失）: ${clientWins} 回`);
  check('目次全体が置き換わらない', clientWins === 0,
    '⚠️ FAIL が期待値。D 案が不成立である証拠そのもの');
}

console.log();
console.log('='.repeat(70));
const failed = results.filter(r => !r.ok);
console.log(`合計 ${results.length} 件 / PASS ${results.length - failed.length} / FAIL ${failed.length}`);
if (failed.length) {
  console.log('FAIL:');
  failed.forEach(r => console.log(`  - ${r.name}`));
}
console.log('='.repeat(70));
