import { NoteBlockSchema } from '@blocksuite/affine-model';
import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import type {
  BlockSnapshot,
  DocSnapshot,
  FromBlockSnapshotPayload,
  FromBlockSnapshotResult,
  FromDocSnapshotPayload,
  FromDocSnapshotResult,
  FromSliceSnapshotPayload,
  FromSliceSnapshotResult,
  SliceSnapshot,
  ToBlockSnapshotPayload,
  ToDocSnapshotPayload,
  ToSliceSnapshotPayload,
} from '@blocksuite/store';
import { BaseAdapter } from '@blocksuite/store';

import { NotificationProvider } from '../../services/notification-service.js';
import { decodeClipboardBlobs, encodeClipboardBlobs } from './utils.js';

export type FileSnapshot = {
  name: string;
  type: string;
  content: string;
};

export class ClipboardAdapter extends BaseAdapter<string> {
  static MIME = 'BLOCKSUITE/SNAPSHOT';

  private readonly _onError = (message: string) => {
    const notification = this.provider.getOptional(NotificationProvider);
    if (!notification) return;

    notification.toast(message);
  };

  override fromBlockSnapshot(
    _payload: FromBlockSnapshotPayload
  ): Promise<FromBlockSnapshotResult<string>> {
    throw new BlockSuiteError(
      ErrorCode.TransformerNotImplementedError,
      'ClipboardAdapter.fromBlockSnapshot is not implemented'
    );
  }

  override fromDocSnapshot(
    _payload: FromDocSnapshotPayload
  ): Promise<FromDocSnapshotResult<string>> {
    throw new BlockSuiteError(
      ErrorCode.TransformerNotImplementedError,
      'ClipboardAdapter.fromDocSnapshot is not implemented'
    );
  }

  override async fromSliceSnapshot(
    payload: FromSliceSnapshotPayload
  ): Promise<FromSliceSnapshotResult<string>> {
    const snapshot = payload.snapshot;
    const assets = payload.assets;
    if (!assets) {
      throw new BlockSuiteError(
        ErrorCode.ValueNotExists,
        'ClipboardAdapter.fromSliceSnapshot: assets is not found'
      );
    }
    const map = assets.getAssets();
    const blobs: Record<string, FileSnapshot> = await encodeClipboardBlobs(
      map,
      this._onError
    );
    return {
      file: JSON.stringify({
        snapshot,
        blobs,
      }),
      assetsIds: [],
    };
  }

  override toBlockSnapshot(
    _payload: ToBlockSnapshotPayload<string>
  ): Promise<BlockSnapshot> {
    throw new BlockSuiteError(
      ErrorCode.TransformerNotImplementedError,
      'ClipboardAdapter.toBlockSnapshot is not implemented'
    );
  }

  override toDocSnapshot(
    _payload: ToDocSnapshotPayload<string>
  ): Promise<DocSnapshot> {
    throw new BlockSuiteError(
      ErrorCode.TransformerNotImplementedError,
      'ClipboardAdapter.toDocSnapshot is not implemented'
    );
  }

  override toSliceSnapshot(
    payload: ToSliceSnapshotPayload<string>
  ): Promise<SliceSnapshot | null> {
    const json = JSON.parse(payload.file);
    const { blobs, snapshot } = json;

    // #253: 中身の無いスナップショットは、無いものとして扱う。
    // 選択の無いコピーで書き込まれたものが利用者のクリップボードに残っており、
    // 取り込むと PasteTr が先頭のブロックを読みにいって落ちる。
    // null を返すと、呼び出し元はほかの形式（text/html・text/plain）に回る
    if (isEmptySliceSnapshot(snapshot)) {
      return Promise.resolve(null);
    }

    const map = payload.assets?.getAssets();
    decodeClipboardBlobs(blobs, map);
    return Promise.resolve(snapshot);
  }
}

/**
 * 取り込むブロックが1つも無いか。
 *
 * 例: `content: []`、または `content: [note（中身なし）]`。
 * 貼り付けでは note を外して中身を取り込むため、空の note も「無い」と同じ。
 * スナップショット自体が無い（undefined）ときも「無い」として扱う。
 */
function isEmptySliceSnapshot(snapshot: SliceSnapshot | undefined): boolean {
  const content = snapshot?.content ?? [];
  return content.every(
    block =>
      block.flavour === NoteBlockSchema.model.flavour &&
      block.children.length === 0
  );
}
