// AI module removed in ofuro-wiki
export function useAIChatConfig() {
  return {
    reasoningConfig: {
      enabled: { value: false },
      setEnabled: () => {},
    },
    docDisplayConfig: {},
    searchMenuConfig: {},
    playgroundConfig: {
      visible: { value: false },
    },
  };
}
