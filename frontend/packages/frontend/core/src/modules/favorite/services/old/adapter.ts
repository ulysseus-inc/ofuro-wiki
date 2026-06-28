import { Service } from '@toeverything/infra';

import type { FavoriteSupportTypeUnion } from '../../constant';
import type { FavoriteService } from '../favorite';

type CompatibleFavoriteSupportType = FavoriteSupportTypeUnion;

/**
 * A service written for compatibility,with the same API as old FavoriteItemsAdapter.
 */
export class CompatibleFavoriteItemsAdapter extends Service {
  constructor(private readonly favoriteService: FavoriteService) {
    super();
  }

  toggle(id: string, type: CompatibleFavoriteSupportType) {
    this.favoriteService.favoriteList.toggle(type, id);
  }

  isFavorite$(id: string, type: CompatibleFavoriteSupportType) {
    return this.favoriteService.favoriteList.isFavorite$(type, id);
  }

  isFavorite(id: string, type: CompatibleFavoriteSupportType) {
    return this.favoriteService.favoriteList.isFavorite$(type, id).value;
  }

  get favorites$() {
    return this.favoriteService.favoriteList.list$.map<
      {
        id: string;
        order: string;
        type: 'doc' | 'collection';
        value: boolean;
      }[]
    >(v =>
      v
        .filter(i => i.type === 'doc' || i.type === 'collection') // only support doc and collection
        .map(i => ({
          id: i.id,
          order: '',
          type: i.type as 'doc' | 'collection',
          value: true,
        }))
    );
  }
}
