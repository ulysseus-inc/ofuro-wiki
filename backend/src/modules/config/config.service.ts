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

    // AFFiNE フロントエンドとの API 互換バージョン（フロント更新時のみ変更）
    const AFFINE_API_VERSION = '0.26.1';
    // ofuro-wiki のリリースバージョン（APP_VERSION 環境変数 or Docker build-arg で管理）
    const appVersion = process.env.APP_VERSION || '0.1.0';

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
