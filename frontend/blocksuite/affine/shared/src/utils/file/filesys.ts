import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import type { BlockStdScope } from '@blocksuite/std';

import { NotificationProvider } from '../../services/notification-service.js';

interface FileTypeSpec {
  description: string;
  accept: Record<string, string[]>;
}

// See [Common MIME types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types)
const FileTypes: FileTypeSpec[] = [
  {
    description: 'Images',
    accept: {
      'image/*': [
        '.avif',
        '.gif',
        // '.ico',
        '.jpeg',
        '.jpg',
        '.png',
        '.tif',
        '.tiff',
        // '.svg',
        '.webp',
      ],
    },
  },
  {
    description: 'Videos',
    accept: {
      'video/*': [
        '.avi',
        '.mp4',
        '.mpeg',
        '.ogg',
        // '.ts',
        '.webm',
        '.3gp',
        '.3g2',
      ],
    },
  },
  {
    description: 'Audios',
    accept: {
      'audio/*': [
        '.aac',
        '.mid',
        '.midi',
        '.mp3',
        '.oga',
        '.opus',
        '.wav',
        '.weba',
        '.3gp',
        '.3g2',
      ],
    },
  },
  {
    description: 'Markdown',
    accept: {
      'text/markdown': ['.md', '.markdown'],
    },
  },
  {
    description: 'Html',
    accept: {
      'text/html': ['.html', '.htm'],
    },
  },
  {
    description: 'Zip',
    accept: {
      'application/zip': ['.zip'],
    },
  },
  {
    description: 'Docx',
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        ['.docx'],
    },
  },
  {
    description: 'MindMap',
    accept: {
      'text/xml': ['.mm', '.opml', '.xml'],
    },
  },
];

/**
 * See https://web.dev/patterns/files/open-one-or-multiple-files/
 */
type AcceptTypes =
  | 'Any'
  | 'Images'
  | 'Videos'
  | 'Audios'
  | 'Markdown'
  | 'Html'
  | 'Zip'
  | 'Docx'
  | 'MindMap';

/**
 * `<input type="file">` の `accept` に渡す値を組み立てる。
 *
 * **MIME だけでは不十分。** `.md` のように OS へ MIME が登録されていない拡張子は、
 * MIME だけを指定するとファイル選択ダイアログに一件も表示されない（Windows が典型）。
 * MIME と拡張子の両方を並べる。
 */
export function acceptAttrFor(acceptType: AcceptTypes): string {
  if (acceptType === 'Any') return '';

  const fileType = FileTypes.find(i => i.description === acceptType);
  if (!fileType)
    throw new BlockSuiteError(
      ErrorCode.DefaultRuntimeError,
      `Unexpected acceptType "${acceptType}"`
    );

  // 例: 'text/markdown,.md,.markdown'
  return [
    ...Object.keys(fileType.accept),
    ...Object.values(fileType.accept).flat(),
  ].join(',');
}

/**
 * ファイル選択ダイアログを開き、選ばれたファイルを返す。
 *
 * - ファイルを選んだ → `File[]`
 * - キャンセルした   → `null`
 * - 選択自体が失敗   → **例外を投げる**（呼び出し側で理由を表示するため）
 *
 * File System Access API（`showOpenFilePicker`）は使わない。
 * インポートは中身を一度読むだけでハンドルを保持しないため利点が無い一方、
 * UNC パス（`\\wsl.localhost\...` 等）のファイルを選ぶと失敗する（Issue #86）。
 * 詳細は docs/import.md を参照。
 */
export async function openFilesWith(
  acceptType: AcceptTypes = 'Any',
  multiple: boolean = true
): Promise<File[] | null> {
  const accept = acceptAttrFor(acceptType);

  return new Promise((resolve, reject) => {
    // Append a new `<input type="file" multiple? />` and hide it.
    const input = document.createElement('input');
    input.classList.add('affine-upload-input');
    input.style.display = 'none';
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;

    document.body.append(input);

    // The `change` event fires when the user interacts with the dialog.
    input.addEventListener('change', () => {
      input.remove();
      resolve(input.files ? Array.from(input.files) : null);
    });
    // The `cancel` event fires when the user cancels the dialog.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });

    // Show the picker.
    // ユーザー操作を伴わずに呼ばれた場合はブラウザが拒否して例外を投げる。
    // 握りつぶすと Promise が解決されず画面が固まるため、そのまま伝える。
    try {
      if ('showPicker' in HTMLInputElement.prototype) {
        input.showPicker();
      } else {
        input.click();
      }
    } catch (err) {
      input.remove();
      reject(err);
    }
  });
}

/**
 * ファイル選択の失敗を利用者に見える形にする。
 *
 * `openFilesWith` はキャンセルでは投げず、**選択自体が失敗したときだけ**投げる。
 * 握りつぶすと「エラーが起きているのに画面には出ない」状態に戻ってしまう
 * （Issue #86 で実際に利用者を誤解させた）。自前のエラー表示を持たない
 * 呼び出し元はこれを使う。
 */
export function notifyFileOpenFailed(std: BlockStdScope, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Failed to open the file picker', error);
  std
    .getOptional(NotificationProvider)
    ?.toast(`Failed to open the file picker: ${message}`);
}

export async function openSingleFileWith(
  acceptType?: AcceptTypes
): Promise<File | null> {
  const files = await openFilesWith(acceptType, false);
  return files?.at(0) ?? null;
}

export async function getImageFilesFromLocal() {
  const files = await openFilesWith('Images');
  return files ?? [];
}

export function downloadBlob(blob: Blob, name: string) {
  const dataURL = URL.createObjectURL(blob);
  const tmpLink = document.createElement('a');
  const event = new MouseEvent('click');
  tmpLink.download = name;
  tmpLink.href = dataURL;
  tmpLink.dispatchEvent(event);

  tmpLink.remove();
  URL.revokeObjectURL(dataURL);
}

// Use lru strategy is a better choice, but it's just a temporary solution.
const MAX_TEMP_DATA_SIZE = 100;
/**
 * TODO @Saul-Mirone use some other way to store the temp data
 *
 * @deprecated Waiting for migration
 */
const tempAttachmentMap = new Map<
  string,
  {
    // name for the attachment
    name: string;
  }
>();
const tempImageMap = new Map<
  string,
  {
    // This information comes from pictures.
    // If the user switches between pictures and attachments,
    // this information should be retained.
    width: number | undefined;
    height: number | undefined;
  }
>();

/**
 * Because the image block and attachment block have different props.
 * We need to save some data temporarily when converting between them to ensure no data is lost.
 *
 * For example, before converting from an image block to an attachment block,
 * we need to save the image's width and height.
 *
 * Similarly, when converting from an attachment block to an image block,
 * we need to save the attachment's name.
 *
 * See also https://github.com/toeverything/blocksuite/pull/4583#pullrequestreview-1610662677
 *
 * @internal
 */
export function withTempBlobData() {
  const saveAttachmentData = (sourceId: string, data: { name: string }) => {
    if (tempAttachmentMap.size > MAX_TEMP_DATA_SIZE) {
      console.warn(
        'Clear the temp attachment data. It may cause filename loss when converting between image and attachment.'
      );
      tempAttachmentMap.clear();
    }

    tempAttachmentMap.set(sourceId, data);
  };
  const getAttachmentData = (blockId: string) => {
    const data = tempAttachmentMap.get(blockId);
    tempAttachmentMap.delete(blockId);
    return data;
  };

  const saveImageData = (
    sourceId: string,
    data: { width: number | undefined; height: number | undefined }
  ) => {
    if (tempImageMap.size > MAX_TEMP_DATA_SIZE) {
      console.warn(
        'Clear temp image data. It may cause image width and height loss when converting between image and attachment.'
      );
      tempImageMap.clear();
    }

    tempImageMap.set(sourceId, data);
  };
  const getImageData = (blockId: string) => {
    const data = tempImageMap.get(blockId);
    tempImageMap.delete(blockId);
    return data;
  };
  return {
    saveAttachmentData,
    getAttachmentData,
    saveImageData,
    getImageData,
  };
}
