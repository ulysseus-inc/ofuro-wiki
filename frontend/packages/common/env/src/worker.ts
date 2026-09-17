export function getWorkerUrl(name: string) {
  // #105: PC 版とスマホ版は同じサーバーから配る（/app/public と /app/public-mobile）。
  // ⚠️ ワーカーの名前は版数だけで、両版で同じだった。先に登録した置き場のものが
  // 返るため、PC 版の画面がスマホ版のワーカーを掴み得る。版を名前に入れて分ける
  const edition = BUILD_CONFIG.isMobileEdition ? 'mobile' : 'web';
  return (
    // NOTE: worker can not use publicPath because it must obey the same-origin policy
    (environment.subPath || '/') +
    'js/' +
    `${name}-${edition}-${BUILD_CONFIG.appVersion}.worker.js`
  );
}
