/**
 * #273: Blob の取得（transport）。大きさの上限は、読みながら守る（#287 レビュー）。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { BlobClient } from '../src/transport/blob';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const auth = {
  getToken: () => Promise.resolve('t'),
  refresh: () => Promise.resolve('t2'),
} as unknown as ConstructorParameters<typeof BlobClient>[1];

/** content-length の無い応答（チャンク転送）。`chunks` 回ぶん `size` バイトを流す */
function streamed(chunks: number, size: number, pulled: { count: number }) {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled.count >= chunks) {
          controller.close();
          return;
        }
        pulled.count++;
        controller.enqueue(new Uint8Array(size));
      },
    }),
    { status: 200, headers: { 'content-type': 'image/png' } }
  );
}

describe('BlobClient（#287 レビュー）', () => {
  it('⚠️ content-length が無くても、上限を超えた時点で読むのをやめる', async () => {
    const pulled = { count: 0 };
    globalThis.fetch = () => Promise.resolve(streamed(100, 10, pulled));
    const client = new BlobClient('https://wiki.example.com', auth, 25);

    await assert.rejects(client.get('ws', 'k'), /大きすぎる/);
    assert.ok(pulled.count < 100, `全部読んだ: ${pulled.count}`);
  });

  it('上限内なら全部読む', async () => {
    const pulled = { count: 0 };
    globalThis.fetch = () => Promise.resolve(streamed(2, 10, pulled));
    const client = new BlobClient('https://wiki.example.com', auth, 25);

    const { data, mime } = await client.get('ws', 'k');
    assert.equal(data.length, 20);
    assert.equal(mime, 'image/png');
  });

  it('⚠️ 受信の途中で切れたら（時間切れ等）、案内付きのエラーにする', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              throw new DOMException(
                'The operation timed out.',
                'TimeoutError'
              );
            },
          }),
          { status: 200 }
        )
      );
    const client = new BlobClient('https://wiki.example.com', auth, 25);
    await assert.rejects(client.get('ws', 'k'), (e: unknown) => {
      return (
        e instanceof Error &&
        e.constructor.name === 'CliError' &&
        /途中で切れた/.test(e.message)
      );
    });
  });
});
