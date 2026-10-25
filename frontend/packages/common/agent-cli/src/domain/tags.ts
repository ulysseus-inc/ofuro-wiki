import { nanoid } from '@blocksuite/affine/store';
import * as Y from 'yjs';

import { CliError } from '../errors';
import type { Session } from './session';
import type { Space } from './space';

/** ブラウザのタグの色（frontend の modules/tag/service/tag.ts と同じ9色） */
const TAG_COLORS = [
  'red',
  'magenta',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'grey',
];

export interface TagDef {
  id: string;
  name: string;
}

/** 無い名前を指定されたとき。`--add` / `--tag` は作り、`--remove` / 絞り込みは拒む */
export enum Missing {
  Create,
  Reject,
}

/**
 * タグの定義（ID・名前・色）。ワークスペースのルート文書にある（設計書 §6.6）。
 *
 * ```
 * meta (Y.Map)
 * └ properties (Y.Map)
 *   └ tags (Y.Map)
 *     └ options (Y.Array)
 *       └ { id, value, color, createDate, updateDate } (Y.Map)
 * ```
 * ページに付いたタグ（ID の並び）は台帳にある。ここは名前と ID の対応だけを持つ。
 */
export class TagCatalog {
  private readonly loaded: Uint8Array;

  private constructor(private readonly doc: Y.Doc) {
    this.loaded = Y.encodeStateVector(doc);
  }

  /** サーバーから最新のルート文書を取って開く */
  static async open(session: Session, space: Space): Promise<TagCatalog> {
    const sync = await session.syncFor(space.id);
    const state = await sync.loadDoc(space.id, space.id);
    if (!state) {
      throw new CliError(`ワークスペースを読めない: ${space.label}`);
    }
    return TagCatalog.fromState(state);
  }

  static fromState(state: Uint8Array): TagCatalog {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return new TagCatalog(doc);
  }

  list(): TagDef[] {
    const options = this.options();
    if (!options) {
      return [];
    }
    return options.toArray().flatMap(option => {
      const id = field(option, 'id');
      const name = field(option, 'value');
      return typeof id === 'string' && typeof name === 'string'
        ? [{ id, name }]
        : [];
    });
  }

  /** ID → 名前。定義に無い ID（消されたタグ等）はそのまま */
  names(ids: string[]): string[] {
    const byId = new Map(this.list().map(t => [t.id, t.name]));
    return ids.map(id => byId.get(id) ?? id);
  }

  /**
   * 名前か ID を、タグの ID に直す。重複は1つにまとめる。
   *
   * `Missing.Create` なら無い名前を作る（ブラウザも入力欄で無い名前を選ぶと確認なしで作る）。
   * 作ったものは送るまで手元にだけある（`takeUpdate`）。
   */
  resolve(
    refs: string[],
    missing: Missing
  ): { ids: string[]; created: TagDef[] } {
    const ids: string[] = [];
    const created: TagDef[] = [];
    for (const ref of refs) {
      const name = ref.trim();
      const tag = this.find(name) ?? this.add(name, missing);
      if (tag.created) {
        created.push(tag.def);
      }
      if (!ids.includes(tag.def.id)) {
        ids.push(tag.def.id);
      }
    }
    return { ids, created };
  }

  /** 名前か ID を ID に直す。1つでも無ければ null（絞り込み用） */
  lookup(refs: string[]): string[] | null {
    const ids: string[] = [];
    for (const ref of refs) {
      const tag = this.find(ref.trim());
      if (!tag) {
        return null;
      }
      ids.push(tag.def.id);
    }
    return ids;
  }

  /** 開いてから作った定義の差分。無ければ null */
  takeUpdate(): Uint8Array | null {
    const update = Y.encodeStateAsUpdate(this.doc, this.loaded);
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    return isSame(update, empty) ? null : update;
  }

  /** 作った定義を送る。作っていなければ何もしない */
  async save(session: Session, space: Space): Promise<void> {
    const update = this.takeUpdate();
    if (!update) {
      return;
    }
    const sync = await session.syncFor(space.id);
    await sync.pushUpdate(space.id, space.id, update);
  }

  private find(ref: string): { def: TagDef; created: boolean } | undefined {
    const tags = this.list();
    const byId = tags.find(t => t.id === ref);
    if (byId) {
      return { def: byId, created: false };
    }

    const byName = tags.filter(t => t.name === ref);
    if (byName.length > 1) {
      throw new CliError(
        `同じ名前のタグが複数ある: ${ref}`,
        `ID で指定する（${byName.map(t => t.id).join(' / ')}）`
      );
    }
    return byName[0] ? { def: byName[0], created: false } : undefined;
  }

  /**
   * 定義を1件足す。
   *
   * ⚠️ 配列全体を置き換えない。ブラウザは置き換えるため、同時に作ると一方が消える
   * （既知の不具合）。CLI は Y.Array に足すだけにして、それを増やさない。
   */
  private add(
    name: string,
    missing: Missing
  ): { def: TagDef; created: boolean } {
    if (missing === Missing.Reject || !name) {
      throw new CliError(`タグが無い: ${name}`, 'ofuro tags で名前を確かめる');
    }

    const id = nanoid();
    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
    const now = Date.now();
    this.doc.transact(() => {
      const option = new Y.Map<unknown>();
      option.set('id', id);
      option.set('value', name);
      option.set('color', `var(--affine-palette-line-${color})`);
      option.set('createDate', now);
      option.set('updateDate', now);
      this.ensureOptions().push([option]);
    });
    return { def: { id, name }, created: true };
  }

  private options(): Y.Array<unknown> | undefined {
    const properties = this.doc.getMap('meta').get('properties');
    const tags = properties instanceof Y.Map ? properties.get('tags') : null;
    const options = tags instanceof Y.Map ? tags.get('options') : null;
    return options instanceof Y.Array ? options : undefined;
  }

  /** 定義が1つも無いワークスペースでは、入れ物から作る */
  private ensureOptions(): Y.Array<unknown> {
    const meta = this.doc.getMap('meta');
    let properties = meta.get('properties');
    if (!(properties instanceof Y.Map)) {
      properties = new Y.Map<unknown>();
      meta.set('properties', properties);
    }
    const props = properties as Y.Map<unknown>;
    let tags = props.get('tags');
    if (!(tags instanceof Y.Map)) {
      tags = new Y.Map<unknown>();
      props.set('tags', tags);
    }
    const tagMap = tags as Y.Map<unknown>;
    let options = tagMap.get('options');
    if (!(options instanceof Y.Array)) {
      options = new Y.Array<unknown>();
      tagMap.set('options', options);
    }
    return options as Y.Array<unknown>;
  }
}

/** 要素は Y.Map のことも素のオブジェクトのこともある（Yjs の配列には両方入る） */
function field(entry: unknown, key: string): unknown {
  if (entry instanceof Y.Map) {
    return entry.get(key);
  }
  if (entry && typeof entry === 'object') {
    return (entry as Record<string, unknown>)[key];
  }
  return undefined;
}

function isSame(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
