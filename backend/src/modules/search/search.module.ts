import { Module } from '@nestjs/common';
import { SearchResolver } from './search.resolver';
import { SearchService } from './search.service';
import { IndexerService } from './indexer.service';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [SearchResolver, SearchService, IndexerService, PrismaService],
  exports: [SearchService, IndexerService],
})
export class SearchModule {}
