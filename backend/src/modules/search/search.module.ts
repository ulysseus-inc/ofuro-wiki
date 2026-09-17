import { Module } from '@nestjs/common';
import { SearchResolver } from './search.resolver';
import { SearchService } from './search.service';
import { IndexerService } from './indexer.service';
import { SearchIndexQueueService } from './search-index-queue.service';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [
    SearchResolver,
    SearchService,
    IndexerService,
    // #101: 索引の作り直し待ちを巡回する（docs/search-index.md 5章）
    SearchIndexQueueService,
    PrismaService,
  ],
  exports: [SearchService, IndexerService],
})
export class SearchModule {}
