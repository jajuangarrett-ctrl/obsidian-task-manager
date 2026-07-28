export function legacyOpenAiApiKey(value: unknown): string {
  if (!isRecord(value) || typeof value.openaiApiKey !== "string") return "";
  return value.openaiApiKey.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
