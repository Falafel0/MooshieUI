export type InsertMode = 'replace' | 'append' | 'prepend';

/** Join whole prompt blocks without splitting commas inside syntax. */
export function insertPrompt(current: string, draft: string, mode: InsertMode): string {
  const text = draft.trim();
  if (!text) return current;
  if (mode === 'replace' || !current.trim()) return text;
  const blocks = mode === 'append' ? [current.trim(), text] : [text, current.trim()];
  return blocks[0] + (blocks[0].endsWith(',') ? ' ' : ', ') + blocks[1];
}
