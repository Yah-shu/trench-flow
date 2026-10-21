// The part of @huggingface/transformers that server/day/embed.ts uses. The package itself is optional (`bun run
// add-matcher`), so type-checking must not need it.
declare module '@huggingface/transformers' {
  export const env: { cacheDir: string }
  export function pipeline(task: string, model: string, options?: Record<string, unknown>): Promise<unknown>
}
