declare interface BUILD_CONFIG_TYPE {
  debug: boolean;
  distribution: 'web' | 'desktop' | 'admin' | 'mobile' | 'ios' | 'android';
  /**
   * 'web' | 'desktop' | 'admin'
   */
  isDesktopEdition: boolean;
  /**
   * 'mobile'
   */
  isMobileEdition: boolean;

  isElectron: boolean;
  isWeb: boolean;
  /**
   * 'desktop' | 'ios' | 'android'
   */
  isNative: boolean;
  isMobileWeb: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isAdmin: boolean;

  /**
   * ⚠️ **通信用**（x-affine-version ヘッダー・同期の clientVersion）。
   * AFFiNE 由来のパッケージ版数で、フォーク元との互換のために変えない。
   * 画面に出すのは productVersion（#105）
   */
  appVersion: string;
  editorVersion: string;
  /** 製品の版数（frontend/package.json）。設定→情報の「アプリ版」に出す（#105） */
  productVersion: string;
  appBuildType: 'stable' | 'beta' | 'internal' | 'canary';

  githubUrl: string;
  changelogUrl: string;
  pricingUrl: string;
  downloadUrl: string;
  discordUrl: string;
  requestLicenseUrl: string;
  // see: tools/workers
  imageProxyUrl: string;
  linkPreviewUrl: string;

  CAPTCHA_SITE_KEY: string;
  SENTRY_DSN: string;
}

declare var BUILD_CONFIG: BUILD_CONFIG_TYPE;
