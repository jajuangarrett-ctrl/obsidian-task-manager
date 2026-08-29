export const UNIFIED_CAPTURE_ACTIONS = ["new-task", "agenda-item", "task-update"] as const;

export type UnifiedCaptureAction = typeof UNIFIED_CAPTURE_ACTIONS[number];

export interface UnifiedCaptureRequest {
  action: UnifiedCaptureAction;
  text: string;
}

export function prepareUnifiedCapture(
  action: string,
  rawText: string
): UnifiedCaptureRequest {
  if (!UNIFIED_CAPTURE_ACTIONS.includes(action as UnifiedCaptureAction)) {
    throw new Error("Choose what you want to create or update.");
  }

  const text = rawText.trim();
  if (!text) throw new Error("Paste or type some text before continuing.");

  return { action: action as UnifiedCaptureAction, text };
}
