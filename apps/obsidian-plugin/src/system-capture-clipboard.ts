export const SYSTEM_CAPTURE_CLIPBOARD_PREFIX = "FJG_TASK_MANAGER_CAPTURE_V1\n";

export function decodeSystemCaptureClipboard(value: string): string | null {
  if (!value.startsWith(SYSTEM_CAPTURE_CLIPBOARD_PREFIX)) return null;

  const payload = value.slice(SYSTEM_CAPTURE_CLIPBOARD_PREFIX.length);
  try {
    return decodeURIComponent(payload);
  } catch {
    // Preserve the user's text if a future Shortcut supplies an unencoded value
    // or the selection contains an incomplete percent escape.
    return payload;
  }
}
