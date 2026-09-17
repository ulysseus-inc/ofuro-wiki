import { readFileSync } from 'node:fs';

import type { Package } from '@ofuro-tools/utils/workspace';

import { PackageToDistribution } from './distribution';
import { ProjectRoot } from './path';

/**
 * #105: 製品の版数（設定→情報の「アプリ版」に出す）。
 *
 * ⚠️ **`appVersion` と混ぜないこと。** `appVersion` は画面表示のほかに
 * `x-affine-version` ヘッダーと同期の `clientVersion` にも使われる通信用の値で、
 * AFFiNE 由来の 0.26.x を保つ（CLAUDE.md「AFFINE_API_VERSION は触らない」と同じ理由）。
 *
 * ⚠️ アプリのパッケージ（apps/web・apps/mobile）の version は使わない。
 * あれは 0.26.x のままで、リリースしても変わらない。
 * `scripts/set-version.sh` が書き換えるのは frontend/package.json であり、
 * docs/release-plan-v0.1.0.md も「UI 表示はここ」と定めている。
 */
function getProductVersion(): string {
  try {
    // ⚠️ ProjectRoot は frontend ディレクトリ（getBlockSuiteVersion と同じ基準）
    const pkgPath = ProjectRoot.join('package.json').toString();
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getBlockSuiteVersion(): string {
  try {
    const bsPkgPath = ProjectRoot.join(
      'blocksuite/affine/all/package.json'
    ).toString();
    const bsPkg = JSON.parse(readFileSync(bsPkgPath, 'utf-8'));
    return bsPkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface BuildFlags {
  channel: 'stable' | 'beta' | 'internal' | 'canary';
  mode: 'development' | 'production';
}

export function getBuildConfig(
  pkg: Package,
  buildFlags: BuildFlags
): BUILD_CONFIG_TYPE {
  const distribution = PackageToDistribution.get(pkg.name);

  if (!distribution) {
    throw new Error(`Distribution for ${pkg.name} is not found`);
  }

  const buildPreset: Record<BuildFlags['channel'], BUILD_CONFIG_TYPE> = {
    get stable() {
      return {
        debug: buildFlags.mode === 'development',
        distribution,
        isDesktopEdition: (
          ['web', 'desktop', 'admin'] as BUILD_CONFIG_TYPE['distribution'][]
        ).includes(distribution),
        isMobileEdition: (
          ['mobile', 'ios', 'android'] as BUILD_CONFIG_TYPE['distribution'][]
        ).includes(distribution),
        isElectron: distribution === 'desktop',
        isWeb: distribution === 'web',
        isMobileWeb: distribution === 'mobile',
        isIOS: distribution === 'ios',
        isAndroid: distribution === 'android',
        isNative:
          distribution === 'desktop' ||
          distribution === 'ios' ||
          distribution === 'android',
        isAdmin: distribution === 'admin',

        appBuildType: 'stable' as const,
        appVersion: pkg.version,
        productVersion: getProductVersion(),
        editorVersion: getBlockSuiteVersion(),
        githubUrl: '',
        changelogUrl: '',
        downloadUrl: '',
        pricingUrl: '',
        discordUrl: '',
        requestLicenseUrl: '',
        imageProxyUrl: '/api/worker/image-proxy',
        linkPreviewUrl: '/api/worker/link-preview',
        CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY ?? '',
        SENTRY_DSN: process.env.SENTRY_DSN ?? '',
      };
    },
    get beta() {
      return {
        ...this.stable,
        appBuildType: 'beta' as const,
        changelogUrl: '',
      };
    },
    get internal() {
      return {
        ...this.stable,
        appBuildType: 'internal' as const,
        changelogUrl: '',
      };
    },
    // canary will be aggressive and enable all features
    get canary() {
      return {
        ...this.stable,
        appBuildType: 'canary' as const,
        changelogUrl: '',
      };
    },
  };

  const currentBuild = buildFlags.channel;

  if (!(currentBuild in buildPreset)) {
    throw new Error(`BUILD_TYPE ${currentBuild} is not supported`);
  }

  const currentBuildPreset = buildPreset[currentBuild];

  const environmentPreset = {
    changelogUrl: process.env.CHANGELOG_URL ?? currentBuildPreset.changelogUrl,
  };

  return {
    ...currentBuildPreset,
    // environment preset will overwrite current build preset
    // this environment variable is for debug proposes only
    // do not put them into CI
    ...(process.env.CI ? {} : environmentPreset),
  };
}
