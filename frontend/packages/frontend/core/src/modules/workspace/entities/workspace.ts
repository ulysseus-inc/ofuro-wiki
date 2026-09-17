import { notify } from '@ofuro/component';
import { I18n } from '@ofuro/i18n';
import type { FeatureFlagService } from '@ofuro/core/modules/feature-flag';
import { Entity, LiveData, yjsGetPath } from '@toeverything/infra';
import type { Observable } from 'rxjs';
import { Doc as YDoc, transact } from 'yjs';

import { DocsService } from '../../doc';
// ⚠️ バレル（modules/discovery の index）から読まないこと。循環参照になる
import { DocMetaWriteService } from '../../discovery/services/doc-meta-write';
import { WorkspaceImpl } from '../impls/workspace';
import type { WorkspaceScope } from '../scopes/workspace';
import { WorkspaceEngineService } from '../services/engine';

export class Workspace extends Entity {
  constructor(
    public readonly scope: WorkspaceScope,
    public readonly featureFlagService: FeatureFlagService,
    // #151 段階3: メタデータの変更をサーバーへ送る
    private readonly docMetaWriteService: DocMetaWriteService
  ) {
    super();
  }

  readonly id = this.scope.props.openOptions.metadata.id;

  readonly openOptions = this.scope.props.openOptions;

  readonly meta = this.scope.props.openOptions.metadata;

  readonly flavour = this.meta.flavour;

  readonly rootYDoc = new YDoc({ guid: this.openOptions.metadata.id });

  // ⚠️ 実装クラスの型で持つ。上流の Workspace には
  // applyRemoteDocMeta（#151 段階3）が無い
  _docCollection: WorkspaceImpl | null = null;

  get docCollection() {
    if (!this._docCollection) {
      // #151 段階3: stale だったとき、サーバーの現在値を取り込む（7.5.10 の7）。
      // ⚠️ **「取ってから捨てる」。** 先に捨てると、送る当ての無い値が残る
      this.docMetaWriteService.onStale = (id, field, result) => {
        // ⚠️ **stale になったフィールドだけを反映すること。**
        // 応答には題とゴミ箱の両方が入っているが、両方を書くと
        // **送信中に利用者が変えた別のフィールドを巻き戻す**
        //（題を送っている間にゴミ箱へ入れた、など）。
        // 段階3 は一貫してフィールド単位で扱う（7.5.8 以降）
        const patch =
          field === 'title'
            ? result?.currentTitle !== undefined
              ? { title: result.currentTitle }
              : undefined
            : field === 'trash'
              ? result?.currentTrash !== undefined
                ? { trash: result.currentTrash }
                : undefined
              : // タグは操作型で stale にならない（版数で弾かない・7.5.10）
                undefined;
        if (!patch) return;

        // ⚠️ **`setDocMeta` を使わないこと。** あちらは送信を伴うため、
        // 受け取った値をサーバーへ送り返して**堂々巡りになる**（7.5.9 の原則5）
        this._docCollection?.meta.applyRemoteDocMeta(id, patch);
      };

      // #151 段階3 / #182: **サーバーの値を手元へ当てる口**を渡す。
      // ⚠️ `setDocMeta` ではなく `applyRemoteDocMeta` を使うこと。
      // 送信を伴う経路だと、受け取った値を送り返す堂々巡りになる（原則5）
      this.docMetaWriteService.applyRemote = (id, patch) => {
        this._docCollection?.meta.applyRemoteDocMeta(id, patch);
      };

      // #151 段階3: 権限が無くて書けなかったら**利用者に伝える**（7.5.10）。
      // ⚠️ stale とは扱いを分ける。stale は競合であってエラーではなく、
      // 毎回出すと「よく分からない警告」に慣れて本当の失敗を見逃す。
      // ⚠️ 画面の値をサーバーへ戻すのは呼び出し元が先に済ませている（#182）
      this.docMetaWriteService.onForbidden = () => {
        notify.error({
          title: I18n['error.ACCESS_DENIED'](),
        });
      };

      this._docCollection = new WorkspaceImpl({
        id: this.openOptions.metadata.id,
        rootDoc: this.rootYDoc,
        featureFlagService: this.featureFlagService,
        // #151 段階3: ⚠️ **ローカルワークスペースには台帳が無い。**
        // ここを常に true にすると、ローカルのページが一覧に出ず開けない
        ledgerDriven: this.flavour !== 'local',
        // #151 段階3: ローカルへ反映したあとにサーバーへ送る（7.5.2）。
        // ⚠️ ここで待たせないこと。`createDoc` の同期連鎖が壊れる（7.5.1）
        onMetaWrite: (id, props, before) => {
          this.docMetaWriteService.send(this.id, id, props, before);
        },
        // #151 段階3: ページの作成・削除を台帳へ知らせる。
        // ⚠️ これが無いと、目次に書かなくなった時点で
        // **新しいページが誰の一覧にも出なくなる**
        onMetaCreate: (id, meta) => {
          this.docMetaWriteService.created(
            this.id,
            id,
            meta.title ?? '',
            'page'
          );
        },
        onMetaDelete: id => {
          this.docMetaWriteService.deleted(this.id, id);
        },
        blobSource: {
          get: async key => {
            const record = await this.engine.blob.get(key);
            return record
              ? new Blob([record.data], { type: record.mime })
              : null;
          },
          delete: async () => {
            return;
          },
          list: async () => {
            return [];
          },
          set: async (id, blob) => {
            await this.engine.blob.set({
              key: id,
              data: new Uint8Array(await blob.arrayBuffer()),
              mime: blob.type,
            });
            return id;
          },
          /* eslint-disable rxjs/finnish */
          blobState$: key => this.engine.blob.blobState$(key),
          upload: key => this.engine.blob.upload(key),
          name: 'blob',
          readonly: false,
        },
        onLoadDoc: doc => this.engine.doc.connectDoc(doc),
        onLoadAwareness: awareness =>
          this.engine.awareness.connectAwareness(awareness),
        onCreateDoc: docId =>
          this.docs.createDoc({ id: docId, skipInit: true }).id,
      });
    }
    return this._docCollection;
  }

  get docs() {
    return this.scope.get(DocsService);
  }

  get canGracefulStop() {
    // TODO
    return true;
  }

  get engine() {
    return this.framework.get(WorkspaceEngineService).engine;
  }

  name$ = LiveData.from<string | undefined>(
    yjsGetPath(this.rootYDoc.getMap('meta'), 'name') as Observable<
      string | undefined
    >,
    undefined
  );

  avatar$ = LiveData.from(
    yjsGetPath(this.rootYDoc.getMap('meta'), 'avatar') as Observable<
      string | undefined
    >,
    undefined
  );

  setAvatar(avatar: string) {
    transact(
      this.rootYDoc,
      () => {
        this.rootYDoc.getMap('meta').set('avatar', avatar);
      },
      { force: true }
    );
  }

  setName(name: string) {
    transact(
      this.rootYDoc,
      () => {
        this.rootYDoc.getMap('meta').set('name', name);
      },
      { force: true }
    );
  }

  override dispose(): void {
    this.docCollection.dispose();
  }
}
