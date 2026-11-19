import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { onboardingContent } from '../onboarding-content';

/** zip の置き場所（@ofuro/templates） */
const TEMPLATES_DIR = new URL(
  '../../../../templates/onboarding/',
  import.meta.url
);

/** zip のローカルファイルヘッダの印と長さ（PKWARE APPNOTE 4.3.7） */
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;
const STORED = 0;
/** 汎用ビット 3: 大きさを後ろ（データディスクリプタ）に置く。このときヘッダの大きさは 0 */
const DATA_DESCRIPTOR_FLAG = 0x08;

/** zip の中のページの題を読む（見本の zip は小さいので、ヘッダを順に読むだけで足りる） */
function snapshotTitles(zipName: string): string[] {
  const buf = readFileSync(fileURLToPath(new URL(zipName, TEMPLATES_DIR)));
  const titles: string[] = [];
  let at = 0;

  while (buf.readUInt32LE(at) === LOCAL_HEADER_SIGNATURE) {
    // 大きさが後ろにある zip は、この読み方では読めない。黙って読み違えずに止める
    if (buf.readUInt16LE(at + 6) & DATA_DESCRIPTOR_FLAG) {
      throw new Error(`${zipName}: data descriptor is not supported`);
    }
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extraLength = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + LOCAL_HEADER_LENGTH + nameLength + extraLength;
    const body = buf.subarray(start, start + size);
    at = start + size;

    if (!name.endsWith('.snapshot.json')) {
      continue;
    }
    const json = method === STORED ? body : inflateRawSync(body);
    titles.push(JSON.parse(json.toString('utf8')).meta.title);
  }
  return titles;
}

/** 新しいワークスペースの見本は、画面の言語で選ぶ（docs/first-workspace.md） */
describe('onboardingContent', () => {
  test('日本語なら日本語版', () => {
    expect(onboardingContent('ja')).toEqual({
      locale: 'ja',
      introTitle: 'はじめに',
      folderGuideTitle: 'フォルダとタグの使い方',
      folderName: 'はじめてのフォルダ',
    });
  });

  test('日本語以外は英語版', () => {
    const en = {
      locale: 'en',
      introTitle: 'Getting Started',
      folderGuideTitle: 'How to Use Folders and Tags',
      folderName: 'First Folder',
    };
    expect(onboardingContent('en')).toEqual(en);
    expect(onboardingContent('zh-Hans')).toEqual(en);
  });

  test.each([
    ['ja', 'onboarding.zip'],
    ['en', 'onboarding-en.zip'],
  ])('【重要】%s の題は、%s の中の題と一致する', (language, zip) => {
    // 一致しないと、最初に開くページもフォルダも見つからず、黙って省かれる
    const content = onboardingContent(language);
    const titles = snapshotTitles(zip);

    expect(titles).toContain(content.introTitle);
    expect(titles).toContain(content.folderGuideTitle);
  });
});
