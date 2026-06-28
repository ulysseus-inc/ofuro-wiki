// 壊れたドキュメントのブロックツリー不整合を検出する診断スクリプト（読み取り専用）
//
// 使い方:
//   DATABASE_URL='postgres://...' node scripts/analyze-doc.mjs <workspaceId> <docId>
//
// docSnapshot(blob) + docUpdate(blob...) を Yjs に復元し、blocks マップを走査して
// 子id重複 / 孤児参照 / 多重親 / 不正な入れ子 などを報告する。DB への書き込みは一切しない。

import * as Y from 'yjs';
import pg from 'pg';

const [, , workspaceId, docId] = process.argv;
if (!workspaceId || !docId) {
  console.error('Usage: DATABASE_URL=... node scripts/analyze-doc.mjs <workspaceId> <docId>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 環境変数が必要です');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// テーブル名は Prisma の @@map に依存。まず存在するテーブルを確認しつつ取得する。
async function fetchRows(table, where, params) {
  try {
    const r = await client.query(`SELECT * FROM "${table}" WHERE ${where}`, params);
    return r.rows;
  } catch (e) {
    return null; // テーブル名違い
  }
}

// snapshot/update テーブル名の候補（Prisma model → 実テーブル名が不明なケースに対応）
const snapCandidates = ['DocSnapshot', 'doc_snapshots', 'snapshots', 'Snapshot'];
const updCandidates = ['DocUpdate', 'doc_updates', 'updates', 'Update'];

async function findTable(cands, where, params) {
  for (const t of cands) {
    const rows = await fetchRows(t, where, params);
    if (rows) return { table: t, rows };
  }
  return { table: null, rows: [] };
}

const snap = await findTable(snapCandidates, `"workspaceId" = $1 AND "docId" = $2`, [workspaceId, docId]);
if (!snap.table) {
  // カラム名も snake の可能性
  const snap2 = await findTable(snapCandidates, `workspace_id = $1 AND doc_id = $2`, [workspaceId, docId]);
  Object.assign(snap, snap2);
}
console.log('snapshot table:', snap.table, 'rows:', snap.rows.length);

const upd = await findTable(updCandidates, `"workspaceId" = $1 AND "docId" = $2 ORDER BY "timestamp" ASC`, [workspaceId, docId]);
if (!upd.table) {
  const upd2 = await findTable(updCandidates, `workspace_id = $1 AND doc_id = $2 ORDER BY timestamp ASC`, [workspaceId, docId]);
  Object.assign(upd, upd2);
}
console.log('update table:', upd.table, 'rows:', upd.rows.length);

if (snap.rows.length === 0) {
  console.error('snapshot が見つかりません。テーブル/カラム名を確認してください。');
  // 参考: 存在するテーブル一覧
  const t = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  console.log('public tables:', t.rows.map(r => r.table_name).join(', '));
  await client.end();
  process.exit(2);
}

const doc = new Y.Doc();
const blobOf = (row) => row.blob ?? row.bin ?? row.data ?? row.update;
Y.applyUpdate(doc, new Uint8Array(blobOf(snap.rows[0])));
for (const row of upd.rows) {
  try { Y.applyUpdate(doc, new Uint8Array(blobOf(row))); } catch (e) { console.warn('update apply skip:', e.message); }
}

const blocks = doc.getMap('blocks');
const ids = [...blocks.keys()];
console.log('\n=== blocks total:', ids.length);

const childrenOf = (id) => {
  const b = blocks.get(id);
  if (!(b instanceof Y.Map)) return [];
  const c = b.get('sys:children');
  return c instanceof Y.Array ? c.toArray() : [];
};
const flavourOf = (id) => {
  const b = blocks.get(id);
  return b instanceof Y.Map ? b.get('sys:flavour') : '(missing)';
};

// 親参照を集計
const parentRefs = new Map(); // childId -> [parentId...]
const dupWithinParent = []; // {parent, child, count}
for (const pid of ids) {
  const kids = childrenOf(pid);
  const seen = new Map();
  for (const cid of kids) {
    seen.set(cid, (seen.get(cid) || 0) + 1);
    if (!parentRefs.has(cid)) parentRefs.set(cid, []);
    parentRefs.get(cid).push(pid);
  }
  for (const [cid, n] of seen) if (n > 1) dupWithinParent.push({ parent: pid, pflavour: flavourOf(pid), child: cid, count: n });
}

// 1. 同一親内での子id重複（lit repeat が即死する典型）
console.log('\n--- [1] 同一親内の子id重複:', dupWithinParent.length);
dupWithinParent.forEach(d => console.log(`  parent ${d.pflavour} ${d.parent.slice(0,8)} に child ${d.child.slice(0,8)}(${flavourOf(d.child)}) が ${d.count}回`));

// 2. 多重親（同じ子が複数の親に参照される）
const multiParent = [...parentRefs.entries()].filter(([, ps]) => new Set(ps).size > 1);
console.log('\n--- [2] 多重親(同じ子が複数の親に):', multiParent.length);
multiParent.forEach(([cid, ps]) => console.log(`  child ${cid.slice(0,8)}(${flavourOf(cid)}) <- parents: ${[...new Set(ps)].map(p=>p.slice(0,8)+'('+flavourOf(p)+')').join(', ')}`));

// 3. 孤児参照（children に挙がっているが blocks に存在しない）
const dangling = [];
for (const pid of ids) for (const cid of childrenOf(pid)) if (!blocks.has(cid)) dangling.push({ parent: pid, child: cid });
console.log('\n--- [3] 存在しない子への参照:', dangling.length);
dangling.forEach(d => console.log(`  parent ${flavourOf(d.parent)} ${d.parent.slice(0,8)} -> 欠落 child ${d.child.slice(0,8)}`));

// 4. どの親からも参照されないブロック（page を除く）
const referenced = new Set([...parentRefs.keys()]);
const unreferenced = ids.filter(id => !referenced.has(id) && flavourOf(id) !== 'affine:page' && flavourOf(id) !== 'affine:surface');
console.log('\n--- [4] 無参照ブロック(page/surface除く):', unreferenced.length);
unreferenced.forEach(id => console.log(`  ${flavourOf(id)} ${id.slice(0,8)}`));

// 5. columns / column-cell まわりの構造
console.log('\n--- [5] columns/column-cell 構造 ---');
const cols = ids.filter(id => flavourOf(id) === 'affine:columns');
const cells = ids.filter(id => flavourOf(id) === 'affine:column-cell');
console.log(`affine:columns: ${cols.length}, affine:column-cell: ${cells.length}`);
for (const col of cols) {
  const kids = childrenOf(col);
  console.log(`  columns ${col.slice(0,8)} columnCount=${blocks.get(col).get('prop:columnCount')} children(${kids.length})=[${kids.map(k=>flavourOf(k)).join(',')}]`);
  for (const cell of kids) {
    if (flavourOf(cell) !== 'affine:column-cell') console.log(`    !! 非column-cellの子: ${flavourOf(cell)} ${cell.slice(0,8)}`);
    const cc = childrenOf(cell);
    const bad = cc.filter(x => ['affine:columns','affine:column-cell','affine:note','affine:page'].includes(flavourOf(x)));
    console.log(`    cell ${cell.slice(0,8)} children(${cc.length})=[${cc.map(k=>flavourOf(k)).join(',')}]${bad.length?'  <<< 不正な入れ子: '+bad.map(b=>flavourOf(b)).join(','):''}`);
  }
}
// column-cell が columns 以外の親に属していないか
for (const cell of cells) {
  const ps = parentRefs.get(cell) || [];
  const badp = ps.filter(p => flavourOf(p) !== 'affine:columns');
  if (badp.length) console.log(`  !! column-cell ${cell.slice(0,8)} が columns 以外に属する: ${badp.map(p=>flavourOf(p)).join(',')}`);
}

// 6. 全 flavour 集計
const byFlavour = {};
for (const id of ids) { const f = flavourOf(id); byFlavour[f] = (byFlavour[f]||0)+1; }
console.log('\n--- [6] flavour 別ブロック数 ---');
console.log(JSON.stringify(byFlavour, null, 1));

console.log('\n=== 完了 ===');
await client.end();
