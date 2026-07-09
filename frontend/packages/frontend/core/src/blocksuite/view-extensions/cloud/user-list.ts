import type { MemberSearchService } from '@ofuro/core/modules/permissions';
import { UserListServiceExtension } from '@blocksuite/affine/shared/services';

export function patchUserListExtensions(memberSearch: MemberSearchService) {
  return UserListServiceExtension({
    // eslint-disable-next-line rxjs/finnish
    hasMore$: memberSearch.hasMore$.signal,
    loadMore() {
      memberSearch.loadMore();
    },
    // eslint-disable-next-line rxjs/finnish
    isLoading$: memberSearch.isLoading$.signal,
    // eslint-disable-next-line rxjs/finnish
    searchText$: memberSearch.searchText$.signal,
    search(keyword) {
      memberSearch.search(keyword);
    },
    // eslint-disable-next-line rxjs/finnish
    users$: memberSearch.result$.map(users =>
      users.map(u => ({
        id: u.id,
        // 表示名が未設定（サインアップで名前を収集しないため name が空になり得る）の
        // 場合は email をフォールバック表示し、メンバーを識別できるようにする。
        name: u.name || u.email,
        avatar: u.avatarUrl,
      }))
    ).signal,
  });
}
