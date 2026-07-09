import { Module } from '@nestjs/common';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [WorkerController],
  providers: [WorkerService, PrismaService],
})
export class WorkerModule {}
