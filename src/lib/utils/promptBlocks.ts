export type ImportedPromptBlock = { name: string; content: string };

/** Paragraphs or explicit Markdown headings; never split commas inside prompt syntax. */
export function parsePromptBlocks(raw: string, mode: 'paragraphs' | 'lines' = 'paragraphs'): ImportedPromptBlock[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const result: ImportedPromptBlock[] = [];
  let name = '';
  let content: string[] = [];
  // Explicit headings define groups and preserve multiline content within them.
  const headings = lines.some(line => /^#{1,3}\s+\S/.test(line));
  function flush() {
    const text = content.join('\n').trim();
    if (text) result.push({ name, content: text });
    name = ''; content = [];
  }
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) { flush(); name = heading[1].trim(); }
    else if (!headings && (mode === 'lines' || !line.trim())) {
      if (mode === 'lines' && line.trim()) content.push(line);
      flush();
    } else content.push(line);
  }
  flush();
  return result;
}

/** Insert whole named blocks; empty imports never remove the current draft. */
export function insertPromptBlocks<T extends ImportedPromptBlock>(current: T[], incoming: T[], mode: 'append' | 'prepend' | 'replace' = 'append'): T[] {
  const blocks = incoming.filter(block => block.content.trim());
  if (!blocks.length) return current;
  if (mode === 'replace') return [...blocks];
  return mode === 'prepend' ? [...blocks, ...current] : [...current, ...blocks];
}
