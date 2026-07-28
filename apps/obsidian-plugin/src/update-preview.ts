export interface TaskUpdatePreview {
  timestamp: string;
  actor: string;
  type: string;
  text: string;
}

export function parseTaskUpdatePreviews(markdown: string): TaskUpdatePreview[] {
  const source = String(markdown || "");
  const headings = [...source.matchAll(/^###\s+(.+?)(?:\s+—\s+(.+?))?\s*$/gm)];
  const updates: TaskUpdatePreview[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index || source.length : source.length;
    const block = source.slice(start, end).trim();
    const type = block.match(/^- Type:\s+`([^`]+)`\s*$/m)?.[1] || "update";
    const text = updateBody(block);
    if (!text) continue;
    updates.push({
      timestamp: match[1].trim(),
      actor: (match[2] || "").trim(),
      type,
      text
    });
  }
  return updates.reverse();
}

function updateBody(block: string): string {
  const lines = block.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || /^-\s+(?:Update ID|Type|Request ID|Status|Related files):/.test(line)) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n").trim();
}
