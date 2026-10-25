/** esbuild の text ローダーで文字列として取り込む（esbuild.config.js） */
declare module '*.md' {
  const content: string;
  export default content;
}
