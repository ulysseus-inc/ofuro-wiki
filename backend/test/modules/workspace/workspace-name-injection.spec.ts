import 'reflect-metadata';
import { BackupService } from '../../../src/modules/backup/backup.service';
import { IndexReaderService } from '../../../src/modules/discovery/index-reader.service';
import { NotificationService } from '../../../src/modules/notification/notification.service';
import { WorkspaceService } from '../../../src/modules/workspace/workspace.service';

/**
 * #319: 名前の読み手は、Nest が注入できる型で受け取る。
 * `Pick<…>` などの型で書くと、型の情報が Object になり、起動時に
 * 「Nest can't resolve dependencies」で backend が立ち上がらない（2026-11-11 開発環境で発生）。
 * 単体テストは手で作ったものを渡すので、この誤りに気づけない
 */
describe('ワークスペース名の読み手の注入 (#319)', () => {
  const paramTypes = (target: object): unknown[] =>
    Reflect.getMetadata('design:paramtypes', target) ?? [];

  it.each([
    ['WorkspaceService', WorkspaceService],
    ['NotificationService', NotificationService],
    // 書き出しの名前（docs/workspace-model.md 12.13）
    ['BackupService', BackupService],
  ])('【重要】%s は IndexReaderService を受け取る', (_label, service) => {
    expect(paramTypes(service)).toContain(IndexReaderService);
    expect(paramTypes(service)).not.toContain(Object);
  });
});
