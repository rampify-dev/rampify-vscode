// esbuild bundles .md imports as strings (--loader:.md=text).
declare module '*.md' {
  const content: string;
  export default content;
}
