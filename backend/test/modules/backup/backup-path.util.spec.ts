import * as path from 'path';
import {
  isSafeArchiveEntry,
  isValidBlobKey,
  resolveWithinDir,
} from '../../../src/modules/backup/backup-path.util';

describe('backup-path.util (L-4 zip-slip 対策)', () => {
  describe('isSafeArchiveEntry', () => {
    it('正当な相対パスを許可する', () => {
      expect(isSafeArchiveEntry('manifest.json')).toBe(true);
      expect(isSafeArchiveEntry('docs/abc.yjs')).toBe(true);
      expect(isSafeArchiveEntry('blobs/ab/abcdef')).toBe(true);
    });

    it('traversal / 絶対パス / NUL を拒否する', () => {
      expect(isSafeArchiveEntry('../etc/passwd')).toBe(false);
      expect(isSafeArchiveEntry('blobs/../../../etc/passwd')).toBe(false);
      expect(isSafeArchiveEntry('docs/../../x.yjs')).toBe(false);
      expect(isSafeArchiveEntry('/etc/passwd')).toBe(false);
      expect(isSafeArchiveEntry('C:\\Windows\\system32')).toBe(false);
      expect(isSafeArchiveEntry('\\\\server\\share\\x')).toBe(false);
      expect(isSafeArchiveEntry('..')).toBe(false);
      expect(isSafeArchiveEntry('a\\..\\..\\b')).toBe(false);
      expect(isSafeArchiveEntry('a\0b')).toBe(false);
      expect(isSafeArchiveEntry('')).toBe(false);
    });
  });

  describe('isValidBlobKey', () => {
    it('base64url の SHA256 キーを許可する', () => {
      expect(isValidBlobKey('N9qo8uLOickgx2ZMRZoMye-_AbCdEf0123456789')).toBe(true);
    });

    it('パス区切り・.. ・空・長すぎるキーを拒否する', () => {
      expect(isValidBlobKey('../../etc/passwd')).toBe(false);
      expect(isValidBlobKey('a/b')).toBe(false);
      expect(isValidBlobKey('a.b')).toBe(false);
      expect(isValidBlobKey('')).toBe(false);
      expect(isValidBlobKey('x'.repeat(129))).toBe(false);
    });
  });

  describe('resolveWithinDir', () => {
    const base = '/data/blobs';

    it('配下のパスは解決される', () => {
      expect(resolveWithinDir(base, 'ab/cd')).toBe(path.resolve(base, 'ab/cd'));
    });

    it('base を抜けるパスは例外', () => {
      expect(() => resolveWithinDir(base, '../../etc/passwd')).toThrow();
      expect(() => resolveWithinDir(base, '/etc/passwd')).toThrow();
    });
  });
});
