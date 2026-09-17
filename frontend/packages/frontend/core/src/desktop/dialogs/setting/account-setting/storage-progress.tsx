export interface StorageProgressProgress {
  upgradable?: boolean;
  onUpgrade: () => void;
}

// ofuro-wiki: No per-user storage quota display
export const StorageProgress = (_props: StorageProgressProgress) => {
  return null;
};
