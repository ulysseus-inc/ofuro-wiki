import { Module } from '@nestjs/common';
import { UserResolver } from './user.resolver';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [NotificationModule],
  controllers: [UserController],
  providers: [UserResolver, UserService, PrismaService],
  exports: [UserService],
})
export class UserModule {}
