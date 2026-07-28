export function responseOutputText(response: unknown): string {
  if (!isRecord(response)) return "";
  const direct = clean(response.output_text);
  if (direct) return direct;
  if (!Array.isArray(response.output)) return "";
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      const text = clean(content.text);
      if (text) return text;
    }
  }
  return "";
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
