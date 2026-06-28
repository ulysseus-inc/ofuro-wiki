import { Module, forwardRef } from '@nestjs/common';
import { CommentService } from './comment.service';
import { CommentResolver, CommentMutationResolver } from './comment.resolver';
import { NotificationModule } from '../notification/notification.module';
import { BlobModule } from '../blob/blob.module';
import { PermissionModule } from '../permission/permission.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    forwardRef(() => NotificationModule),
    BlobModule,
    PermissionModule,
  ],
  providers: [
    CommentService,
    CommentResolver,
    CommentMutationResolver,
    PrismaService,
  ],
  exports: [CommentService],
})
export class CommentModule {}
