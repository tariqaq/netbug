// Types for imports the kinetograph CLI maps at bundle time.
declare module '@remotion/google-fonts/*' {
  export function loadFont(style?: string, options?: { weights?: string[]; subsets?: string[] }): { fontFamily: string };
}
