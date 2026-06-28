import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const AVATAR_DIR = process.env.AVATAR_STORAGE_PATH || './data/avatars';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async updateUser(id: string, data: {
    name?: string;
    avatarUrl?: string;
    receiveInvitationEmail?: boolean;
    receiveMentionEmail?: boolean;
    receiveCommentEmail?: boolean;
  }) {
    return this.prisma.user.update({ where: { id }, data });
  }

  async saveAvatar(
    userId: string,
    file: { filename: string; mimetype: string; createReadStream: () => NodeJS.ReadableStream },
  ): Promise<string> {
    // Ensure directory exists
    if (!fs.existsSync(AVATAR_DIR)) {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
    }

    // Determine file extension from mimetype
    const ext = file.mimetype === 'image/png' ? '.png'
      : file.mimetype === 'image/gif' ? '.gif'
      : file.mimetype === 'image/webp' ? '.webp'
      : '.jpg';

    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(AVATAR_DIR, filename);

    // Remove old avatar file if exists
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.avatarUrl) {
      const oldFilename = user.avatarUrl.replace('/api/avatars/', '');
      const oldPath = path.join(AVATAR_DIR, oldFilename);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Save new file
    await new Promise<void>((resolve, reject) => {
      const stream = file.createReadStream();
      const writeStream = fs.createWriteStream(filePath);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const avatarUrl = `/api/avatars/${filename}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    return avatarUrl;
  }

  async removeAvatar(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.avatarUrl) {
      const filename = user.avatarUrl.replace('/api/avatars/', '');
      const filePath = path.join(AVATAR_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    return true;
  }
}
