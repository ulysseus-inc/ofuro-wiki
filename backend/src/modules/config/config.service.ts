import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ConfigService {
  constructor(private prisma: PrismaService) {}

  async getServerConfig() {
    const registrationSetting =
      await this.prisma.serverSetting.findUnique({
        where: { key: 'registration_open' },
      });
    const registrationOpen = registrationSetting?.value !== 'false';

    const features = ['Indexer', 'Comment'];
    if (process.env.MAILER_HOST && process.env.MAILER_PORT) {
      features.push('Email');
    }

    // AFFiNE フロントエンドとの API 互換バージョン。
    // ⚠️ これは ofuro-wiki の製品バージョンでは「ない」。フォーク元 AFFiNE の版数であり、
    //    フロントエンドを上流に追従させたときだけ変更する。リリース時に触ってはいけない。
    const AFFINE_API_VERSION = '0.26.1';
    // ofuro-wiki の製品バージョン。正は Git タグ（vX.Y.Z）で、CI が
    // --build-arg VERSION → ENV APP_VERSION として焼き込む（#87）。
    // 未設定時（ローカル開発など）は開発版であることが分かる値にする。
    const appVersion = process.env.APP_VERSION || '0.0.0-dev';

    return {
      version: AFFINE_API_VERSION,
      appVersion,
      name: 'ofuro-wiki',
      baseUrl: process.env.BASE_URL || 'http://localhost:3010',
      type: 'Selfhosted',
      features,
      credentialsRequirement: {
        password: {
          minLength: 8,
          maxLength: 128,
        },
      },
      oauthProviders: [],
      initialized: true,
      registrationOpen,
      calendarProviders: [],
      calendarCalDAVProviders: [],
      defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ja',
    };
  }
}
