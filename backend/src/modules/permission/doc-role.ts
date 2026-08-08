/**
 * #97: ドキュメントのロールと権限マトリクス（docs/doc-permission.md 4・5章）。
 *
 * ⚠️ **ここが権限の唯一の定義。**
 * 「Owner なら」「Manager 以上なら」という判断を、**他の場所に書かないこと。**
 * 経路側が知ってよいのはアクション名（`Doc_Read` 等）だけである。
 */

/** `frontend/.../schema.ts` の `DocRole` に合わせる。 */
export const DOC_ROLES = [
  'Owner',
  'Manager',
  'Editor',
  'Commenter',
  'Reader',
  'External',
  'None',
] as const;

export type DocRole = (typeof DOC_ROLES)[number];

/** `doc-role-permissions.gql` のアクション17種。 */
export const DOC_ACTIONS = [
  'Doc_Read',
  'Doc_Update',
  'Doc_Delete',
  'Doc_Trash',
  'Doc_Restore',
  'Doc_Copy',
  'Doc_Duplicate',
  'Doc_Publish',
  'Doc_TransferOwner',
  'Doc_Properties_Read',
  'Doc_Properties_Update',
  'Doc_Users_Read',
  'Doc_Users_Manage',
  'Doc_Comments_Create',
  'Doc_Comments_Read',
  'Doc_Comments_Delete',
  'Doc_Comments_Resolve',
] as const;

export type DocAction = (typeof DOC_ACTIONS)[number];

/**
 * ロール × アクションの対応（docs/doc-permission.md 5章の表がそのまま入る）。
 *
 * ⚠️ **`None` は必ず空。** これが「アクセス不可」の定義である。
 */
const MATRIX: Record<DocRole, readonly DocAction[]> = {
  Owner: DOC_ACTIONS,

  Manager: [
    'Doc_Read',
    'Doc_Update',
    'Doc_Trash',
    'Doc_Restore',
    'Doc_Copy',
    'Doc_Duplicate',
    'Doc_Publish',
    'Doc_Properties_Read',
    'Doc_Properties_Update',
    'Doc_Users_Read',
    'Doc_Users_Manage',
    'Doc_Comments_Create',
    'Doc_Comments_Read',
    'Doc_Comments_Delete',
    'Doc_Comments_Resolve',
  ],

  Editor: [
    'Doc_Read',
    'Doc_Update',
    'Doc_Trash',
    'Doc_Restore',
    'Doc_Copy',
    'Doc_Duplicate',
    'Doc_Properties_Read',
    'Doc_Properties_Update',
    'Doc_Comments_Create',
    'Doc_Comments_Read',
    'Doc_Comments_Resolve',
  ],

  Commenter: [
    'Doc_Read',
    'Doc_Copy',
    'Doc_Properties_Read',
    'Doc_Comments_Create',
    'Doc_Comments_Read',
    'Doc_Comments_Resolve',
  ],

  Reader: ['Doc_Read', 'Doc_Copy', 'Doc_Properties_Read', 'Doc_Comments_Read'],

  // 公開共有からの閲覧者。読むだけ。
  // 公開ページから社内の運用情報（誰が権限を持つか等）が漏れるのを防ぐ。
  External: ['Doc_Read'],

  // ⚠️ ここに何かを足してはいけない。「アクセス不可」でなくなる。
  None: [],
};

/** そのロールがアクションを行えるか。 */
export function roleCan(role: DocRole, action: DocAction): boolean {
  return MATRIX[role].includes(action);
}

/** ロール名を正規化する。未知の値は `None`（安全側）に倒す。 */
export function toDocRole(value: string | null | undefined): DocRole {
  if (!value) return 'None';
  const found = DOC_ROLES.find(
    (r) => r.toLowerCase() === String(value).toLowerCase(),
  );
  // ⚠️ 未知の値を「読める」側に倒さない。
  // DB に想定外の文字列が入っていたら、アクセスを許すより拒む方が安全。
  return found ?? 'None';
}

/**
 * ワークスペースのロール → ドキュメントのロール（docs/doc-permission.md 4.3）。
 *
 * 非メンバーは `null` を返す。**`None` ではなく `null`。**
 * 「ワークスペースに居ない」と「居るがアクセス不可」を区別するため。
 */
export function fromWorkspaceRole(
  workspaceRole: string | null | undefined,
): DocRole | null {
  switch (String(workspaceRole ?? '').toLowerCase()) {
    case 'owner':
    case 'admin':
      return 'Owner';
    case 'member':
      return 'Editor';
    case 'reader':
      return 'Reader';
    default:
      return null;
  }
}

/**
 * ワークスペースのメンバー経路で使うロール変換。
 *
 * ⚠️ **`External` を通さない。** `External` は公開共有トークンによる
 * **別の認証経路**専用であり、ワークスペースのメンバーシップを前提にしない。
 * 実効ロールの計算に混ぜると、4.2 の⓪「非メンバーは不許可」を
 * **回避する抜け道**になる（DB に `External` を書けば誰でも読める）。
 */
export function toMemberDocRole(value: string | null | undefined): DocRole {
  const role = toDocRole(value);
  return role === 'External' ? 'None' : role;
}

/**
 * ワークスペースのメンバー経路で「読める」ロール名（小文字）。
 *
 * ⚠️ `External` を含めない（上記と同じ理由）。
 */
export const MEMBER_READABLE_ROLE_NAMES: string[] = DOC_ROLES.filter(
  (r) => r !== 'External' && roleCan(r, 'Doc_Read'),
).map((r) => r.toLowerCase());

/**
 * ドキュメントの**既定ロール**として保存してよい値。
 *
 * ⚠️ **読み出し側で値を寄せてはいけない。** 寄せると保存した値と読み出した値が
 * 食い違い、画面はその表示値をそのまま保存に使うため、
 * **メニューを開いて保存しただけで権限が下がる**。往復で変わらないよう、
 * **保存できる値のほうを制限する。**
 *
 * | 除外するもの | 理由 |
 * |---|---|
 * | `Owner` | ワークスペース全員をドキュメントの所有者にする意味になる |
 * | `External` | 公開共有トークン専用の別経路。メンバーの既定にはならない |
 * | `Commenter` | 画面に選択肢が無く、保存されると**ロール名が空欄**になる |
 */
export const DOC_DEFAULT_ROLES = [
  'Manager',
  'Editor',
  'Reader',
  'None',
] as const satisfies readonly DocRole[];

export function isDocDefaultRole(role: DocRole): boolean {
  return (DOC_DEFAULT_ROLES as readonly DocRole[]).includes(role);
}

/**
 * ロールの強さ（大きいほど強い）。**権限昇格の判定にだけ使う。**
 *
 * ⚠️ 通常の可否判定に順序を持ち込まないこと。可否は
 * 権限マトリクス（`roleCan`）が唯一の正である。
 */
const RANK: Record<DocRole, number> = {
  Owner: 60,
  Manager: 50,
  Editor: 40,
  Commenter: 30,
  Reader: 20,
  External: 10,
  None: 0,
};

/**
 * `actor` が `target` のロールを**他人に配ってよいか**。
 *
 * ⚠️ **自分より強いロールは配れない。** `Doc_Users_Manage` を持つだけで
 * `Owner`（`Doc_TransferOwner` / `Doc_Delete` を含む）を配れると、
 * doc の Manager が**自分を Owner に昇格できてしまう**。
 *
 * ⚠️ `External` は公開共有トークン専用の別経路であり、
 * メンバーへ配るものではない（[[toMemberDocRole]] と同じ理由）。
 */
export function canGrantDocRole(actor: DocRole, target: DocRole): boolean {
  if (target === 'External') return false;
  return RANK[target] <= RANK[actor];
}
