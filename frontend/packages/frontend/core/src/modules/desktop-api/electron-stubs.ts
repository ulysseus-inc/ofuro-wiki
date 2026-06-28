// Stubs for @affine/electron-api (web-only build, no Electron)
// All runtime exports are null/undefined since Electron APIs are not available.

export type ClientHandler = Record<
  string,
  Record<string, (...args: any[]) => Promise<any>>
>;
export type ClientEvents = Record<string, any>;
export type AppInfo = {
  electronVersion: string;
  schema: string;
  windowName: string;
  viewId?: string;
};
export type SharedStorage = Record<string, any>;
export type UpdateMeta = { version: string; allowAutoUpdate: boolean };
export type TabViewsMetaSchema = Record<string, any>;

export const appInfo: AppInfo | null = null;
export const apis: ClientHandler | undefined = undefined;
export const events: ClientEvents | undefined = undefined;
export const sharedStorage: SharedStorage | undefined = undefined;
