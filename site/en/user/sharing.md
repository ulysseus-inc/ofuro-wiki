# Sharing and permissions

These are the rules for who can read and write which pages.

## Three levels

```
Server     … administrator or regular user
 └ Workspace … which workspaces you are in, and with what role
    └ Page      … who can read or write each page (if not restricted, the workspace role applies)
```

## Workspace roles (shared workspaces)

| Role | What they can do |
|---|---|
| Workspace admin | Read and write pages, change settings such as the name, invite people, switch people between member and reader |
| Member | Read, write, and create pages |
| Reader | Read pages only |

- Invited people start as members. A workspace admin changes roles.
- System administrators choose the workspace admins.
- System administrators can manage every shared workspace even without an invitation.
  They **cannot open other people's private workspaces**, though.

## Inviting people

Workspace admins invite people with **Invite members** in the left sidebar.

- People who already have an account become members right away.
- People without an account get an invitation email or link. They create an account from it and join in one step.

## Restricting a page

For each page you can decide who can read or write it.

1. Open the page and press **Share** at the top right.
2. Pick people and a permission (the default is **Can edit**).
3. On the same screen you can also change the default for everyone in the workspace (general access).

| Permission | Read | Write | Change this page's sharing |
|---|:-:|:-:|:-:|
| Can manage | ✅ | ✅ | ✅ |
| Can edit | ✅ | ✅ | ❌ |
| Read only | ✅ | ❌ | ❌ |
| No access (general access only) | ❌ | ❌ | ❌ |

- ⚠️ **Pages you cannot read never appear in lists or search.** Not only the content — you cannot even tell the page exists (the title is hidden too).
- Workspace admins are never locked out by page restrictions.
- ⚠️ A reader cannot write even if a page gives them **Can edit**. Make them a member of the workspace instead.
- ⚠️ Images and attachments on a page, and comments, are not covered by page restrictions. Anyone in the workspace can see them.
  Do not put anything you need to hide in that workspace.

## Creating a confidential page

For pages that only some people in the workspace should see, such as HR or management material:

1. Create the page and, **before writing anything**, press **Share** at the top right.
2. Set **Members in workspace** to **No access**.
3. Use **Invite other members** to pick the people who should see it, and choose a permission (the default is **Can edit**).

People you did not pick never see the page in lists or search results, and cannot see its title. Opening the URL shows it as not found.

- Workspace admins are not locked out (they can read it).
- The setting is not inherited by child pages or folders. Set it **on each page**.
- If you give someone **Can manage**, they can show the page to more people. To keep it from spreading, use **Can edit** or **Read only**.

::: warning Images, attachments, and comments are not hidden
Images and attachments on a page, and comments, are not covered by page restrictions. Anyone in the workspace can see them.
If you keep confidential material as files, or the same small group always needs access, **ask an administrator to create a shared workspace just for those people**. That is more reliable.
:::

## Stopping sharing

Remove someone in the **Share** screen and the page disappears from their list. If they had it open, it is hidden the next time they open it.
