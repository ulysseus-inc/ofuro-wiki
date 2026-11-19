import { existsSync } from 'fs';
import { DynamicModule } from '@nestjs/common';
import { ServeStaticModule, ServeStaticModuleOptions } from '@nestjs/serve-static';

/** #324: ガイド（VitePress）を配るパス（docs/docs-site.md 5.1） */
export const DOCS_ROUTE = '/docs';

const API_EXCLUDES = ['/graphql{*path}', '/socket.io{*path}', '/api{*path}'];

/** 画面の SPA 用の「無いパスは index.html」を、効かせたくないモジュールに付ける */
const NO_FALLBACK = '/__no_spa_fallback__';

export interface StaticDirs {
  /** 画面（デスクトップ） */
  frontend: string;
  /** 画面（スマホ） */
  mobile: string;
  /** ガイド */
  docs: string;
}

/**
 * 画面とガイドの配信。ビルド結果のあるものだけを登録する（開発中は無い）。
 *
 * ```
 * 1. スマホの画面   アセットだけ（HTML は MobileRedirectMiddleware が返す）
 * 2. ガイド         /docs/*。無いページは 404 で止め、3 の SPA に落とさない
 * 3. デスクトップ   残り全部。無いパスは index.html（SPA）
 * ```
 */
export function staticImports(dirs: StaticDirs): DynamicModule[] {
  const imports: ServeStaticModuleOptions[] = [];

  // 1. スマホ: ハッシュ付きのアセットを先に探す。SPA のフォールバックはしない
  if (existsSync(dirs.mobile)) {
    imports.push(
      {
        rootPath: dirs.mobile,
        exclude: API_EXCLUDES,
        renderPath: NO_FALLBACK,
        serveStaticOptions: { index: false },
      },
    );
  }

  // 2. ガイド: cleanUrls（/guide/x → guide/x.html）。無ければ 404
  if (existsSync(dirs.docs)) {
    imports.push(
      {
        rootPath: dirs.docs,
        serveRoot: DOCS_ROUTE,
        renderPath: NO_FALLBACK,
        serveStaticOptions: { extensions: ['html'], fallthrough: false },
      },
    );
  }

  // 3. デスクトップ: 残り全部。ガイドのパスは SPA に渡さない
  if (existsSync(dirs.frontend)) {
    imports.push(
      {
        rootPath: dirs.frontend,
        // /docs と /docs/… だけ。/docs{*path} だと /docs-foo まで外れ、画面に届かず 404 になる
        exclude: [...API_EXCLUDES, DOCS_ROUTE, `${DOCS_ROUTE}/{*path}`],
      },
    );
  }

  // 1 回の forRoot に並べる（この順に探す）
  return imports.length ? [ServeStaticModule.forRoot(...imports)] : [];
}
