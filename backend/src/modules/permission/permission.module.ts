import { Module } from '@nestjs/common';
import { PermissionResolver } from './permission.resolver';
import { PermissionService } from './permission.service';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [PermissionResolver, PermissionService, PrismaService],
  exports: [PermissionService],
})
export class PermissionModule {}
