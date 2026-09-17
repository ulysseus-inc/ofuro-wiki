import type { Store } from '@blocksuite/affine/store';
import type { Map as YMap } from 'yjs';

/**
 * TODO(@eyhn): Define error to unexpected state together in the future.
 */
export class NoPageRootError extends Error {
  constructor(public page: Store) {
    super('Page root not found when render editor!');

    // #151 stage 3 (PR5-c): this used to report whether the doc was listed in
    // the root doc's `spaces` map. We no longer write that map, so the check
    // would now always say "no" and send whoever reads this log chasing a
    // problem that isn't there. Report whether the space doc actually loaded
    // instead - that is what the caller needs to know here.
    const spaceLoaded = page.spaceDoc.isLoaded;
    const blocks = page.spaceDoc.getMap('blocks') as YMap<YMap<any>>;
    const havePageBlock = Array.from(blocks.values()).some(
      block => block.get('sys:flavour') === 'affine:page'
    );
    console.info(
      'NoPageRootError current data: %s',
      JSON.stringify({
        expectPageId: page.id,
        expectGuid: page.spaceDoc.guid,
        spaceLoaded,
        blockSize: blocks.size,
        havePageBlock,
      })
    );
  }
}
