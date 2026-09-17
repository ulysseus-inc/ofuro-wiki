/**
 * #151 段階3 A案 前提条件の検証
 *
 * 検証する命題（docs/discovery-stage3-comparison.md 7.5.1）:
 *   「createDoc は addDocMeta の直後に getDoc を呼ぶ同期連鎖に依存しているため、
 *     A 案で『サーバーを正としてローカルへ反映』は採れない」
 *
 * ⚠️ これはコード読解による結論だったため、実験事実に変える。
 *
 * 実装の写し（構造は本物に合わせている）:
 *   frontend/.../modules/workspace/impls/meta.ts:140  addDocMeta
 *   frontend/.../modules/workspace/impls/meta.ts:112  _handleDocMetaEvent → docMetaAdded
 *   frontend/.../modules/workspace/impls/workspace.ts:93   docMetaAdded → blockCollections.set
 *   frontend/.../modules/workspace/impls/workspace.ts:141-147  createDoc
 */
import * as Y from 'yjs';
import { Subject } from 'rxjs';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (detail) console.log(`      ${detail}`);
}

/** meta.ts の写し。addDocMeta の同期/非同期を差し替えられるようにしてある */
class MetaImpl {
  docMetaAdded = new Subject();
  _prevDocs = new Set();

  constructor(doc) {
    this._doc = doc;
    this._yMap = doc.getMap('meta');
    this._yMap.set('pages', new Y.Array());
    // meta.ts:109 observeDeep
    this._yMap.observeDeep(() => this._handleDocMetaEvent());
  }

  get docs() {
    return this._yMap.get('pages');
  }

  get docMetas() {
    return this.docs.toArray().map(p => ({ id: p.get('id'), title: p.get('title') }));
  }

  // meta.ts:112 _handleDocMetaEvent
  _handleDocMetaEvent() {
    const newDocs = new Set();
    this.docMetas.forEach(m => {
      if (!this._prevDocs.has(m.id)) this.docMetaAdded.next(m.id);
      newDocs.add(m.id);
    });
    this._prevDocs = newDocs;
  }

  // meta.ts:140 addDocMeta（同期）
  addDocMeta(meta) {
    this._doc.transact(() => {
      const p = new Y.Map();
      p.set('id', meta.id);
      p.set('title', meta.title);
      this.docs.push([p]);
    }, this._doc.clientID);
  }

  /** サーバー往復を挟んだ場合。実装者が素直に async 化するとこうなる */
  async addDocMetaAsync(meta) {
    await sendToServer(meta); // ← サーバーへ書いてから反映
    this.addDocMeta(meta);
  }
}

/** サーバー往復の模擬（1 tick でも await が入れば同じ結果になる） */
function sendToServer() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** workspace.ts の写し */
class WorkspaceImpl {
  blockCollections = new Map();

  constructor() {
    this.doc = new Y.Doc();
    this.meta = new MetaImpl(this.doc);
    // workspace.ts:93
    this.meta.docMetaAdded.subscribe(docId => {
      this.blockCollections.set(docId, { id: docId, __doc: true });
    });
  }

  // workspace.ts:141-147
  createDoc(id) {
    this.meta.addDocMeta({ id, title: '', createDate: Date.now(), tags: [] });
    return this.getDoc(id);
  }

  /** addDocMeta だけをサーバー先行にした場合 */
  createDocServerFirst(id) {
    this.meta.addDocMetaAsync({ id, title: '', createDate: Date.now(), tags: [] });
    return this.getDoc(id); // createDoc は同期メソッドなので await できない
  }

  /** 非同期の完了まで待ってから取り出した場合（対照） */
  async createDocAwaited(id) {
    await this.meta.addDocMetaAsync({ id, title: '', createDate: Date.now(), tags: [] });
    return this.getDoc(id);
  }

  getDoc(docId) {
    return this.blockCollections.get(docId) ?? null;
  }
}

console.log('='.repeat(72));
console.log('ケース1: 正常系（現在の実装）— addDocMeta は同期');
console.log('='.repeat(72));
{
  const ws = new WorkspaceImpl();
  const doc = ws.createDoc('A');
  check('createDoc が doc を返す', doc !== null, `getDoc("A") = ${JSON.stringify(doc)}`);
  check(
    'addDocMeta の戻り時点で registry へ登録済み',
    ws.blockCollections.has('A'),
    'Yjs の observeDeep が transact 内で同期発火している証拠'
  );
}

console.log();
console.log('='.repeat(72));
console.log('ケース2: addDocMeta をサーバー先行（async）にした場合');
console.log('='.repeat(72));
{
  const ws = new WorkspaceImpl();
  const doc = ws.createDocServerFirst('A');
  check(
    '⚠️ createDoc が null を返す（= ドキュメント作成が壊れる）',
    doc === null,
    `getDoc("A") = ${JSON.stringify(doc)} / FAIL ならローカル先行は不要ということになる`
  );
}

console.log();
console.log('='.repeat(72));
console.log('ケース3: 対照 — 非同期の完了を待ってから取り出す');
console.log('  「非同期だから駄目」なのか「同期登録が必要」なのかを分ける');
console.log('='.repeat(72));
{
  const ws = new WorkspaceImpl();
  const doc = await ws.createDocAwaited('A');
  check(
    '待てば doc は取れる',
    doc !== null,
    `getDoc("A") = ${JSON.stringify(doc)}`
  );
  console.log();
  console.log('  → 非同期そのものが壊すのではない。');
  console.log('    createDoc が同期メソッドで await できない以上、');
  console.log('    「同期的に registry へ登録されること」が要求である。');
}

console.log();
console.log('='.repeat(72));
console.log('ケース4: 呼び出し側は createDoc を await できるか（実装の制約）');
console.log('='.repeat(72));
{
  const ws = new WorkspaceImpl();
  const returned = ws.createDoc('A');
  check(
    'createDoc の戻り値は Promise ではない',
    !(returned instanceof Promise),
    `typeof = ${typeof returned} / BlockSuite の Workspace インターフェースが同期を要求する`
  );
}

console.log();
console.log('='.repeat(72));
const failed = results.filter(r => !r.ok);
console.log(`合計 ${results.length} 件 / PASS ${results.length - failed.length} / FAIL ${failed.length}`);
if (failed.length) {
  console.log('FAIL:');
  failed.forEach(r => console.log(`  - ${r.name}`));
  console.log();
  console.log('⚠️ FAIL が出た場合、7.5.1 の前提が崩れている可能性がある。');
  console.log('   docs/discovery-stage3-comparison.md 7.5 を再検討すること。');
} else {
  console.log('→ 7.5.1「サーバー先行は採れない」は実験事実として確認された。');
}
console.log('='.repeat(72));
