import { requestUrl } from "obsidian";
import {
  buildTaskDraftRequest,
  parseTaskDraftResponse,
  TaskCaptureDraft
} from "./quick-capture-model";

export interface VoiceRecorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export interface DraftTaskOptions {
  apiKey: string;
  model: string;
  rawCapture: string;
  projects: string[];
  now?: Date;
  timeZone?: string;
}

export async function startVoiceRecording(): Promise<VoiceRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone recording is not available on this device.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickSupportedMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.start();

  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  return {
    stop: () => new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("stop", () => {
        stopTracks();
        resolve(new Blob(chunks, {
          type: recorder.mimeType || mimeType || "audio/webm"
        }));
      }, { once: true });
      recorder.addEventListener("error", () => {
        stopTracks();
        reject(new Error("The voice recording could not be completed."));
      }, { once: true });
      try {
        recorder.stop();
      } catch (error) {
        stopTracks();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }),
    cancel: () => {
      try {
        recorder.stop();
      } catch {
        // The recorder may already be stopped.
      }
      stopTracks();
    }
  };
}

export async function transcribeTaskAudio(
  audio: Blob,
  apiKey: string,
  model: string
): Promise<string> {
  requireApiKey(apiKey);
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const boundary = `----fjg-task-capture-${crypto.randomUUID()}`;
  const body = buildMultipart(boundary, [
    {
      name: "file",
      filename: filenameForBlob(audio),
      contentType: audio.type || "audio/webm",
      data: audioBytes
    },
    { name: "model", data: model },
    { name: "response_format", data: "json" }
  ]);
  const response = await requestUrl({
    url: "https://api.openai.com/v1/audio/transcriptions",
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer,
    throw: false
  });
  if (response.status >= 400) throw openAiError(response.status, response.json);
  const text = isRecord(response.json) ? String(response.json.text || "").trim() : "";
  if (!text) throw new Error("OpenAI returned an empty transcription.");
  return text;
}

export async function draftTaskFromCapture(options: DraftTaskOptions): Promise<TaskCaptureDraft> {
  requireApiKey(options.apiKey);
  const rawCapture = options.rawCapture.trim();
  if (!rawCapture) throw new Error("Add or dictate task details before drafting.");
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const response = await requestUrl({
    url: "https://api.openai.com/v1/responses",
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildTaskDraftRequest(
      rawCapture,
      options.model,
      {
        projects: options.projects,
        now: options.now || new Date(),
        timeZone
      }
    )),
    throw: false
  });
  if (response.status >= 400) throw openAiError(response.status, response.json);
  return parseTaskDraftResponse(response.json, rawCapture, options.projects);
}

export async function testOpenAiKey(apiKey: string): Promise<void> {
  requireApiKey(apiKey);
  const response = await requestUrl({
    url: "https://api.openai.com/v1/models",
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    throw: false
  });
  if (response.status >= 400) throw openAiError(response.status, response.json);
}

function requireApiKey(apiKey: string): void {
  if (!apiKey.trim()) throw new Error("Add an OpenAI API key in FJG Task Manager settings.");
}

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg"
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

interface MultipartField {
  name: string;
  filename?: string;
  contentType?: string;
  data: Uint8Array | string;
}

function buildMultipart(boundary: string, fields: MultipartField[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"`;
    if (field.filename) header += `; filename="${field.filename}"`;
    header += "\r\n";
    if (field.contentType) header += `Content-Type: ${field.contentType}\r\n`;
    header += "\r\n";
    parts.push(encoder.encode(header));
    parts.push(typeof field.data === "string" ? encoder.encode(field.data) : field.data);
    parts.push(encoder.encode("\r\n"));
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function filenameForBlob(blob: Blob): string {
  const type = blob.type.toLowerCase();
  if (type.includes("mp4")) return "task-capture.m4a";
  if (type.includes("mpeg")) return "task-capture.mp3";
  if (type.includes("wav")) return "task-capture.wav";
  return "task-capture.webm";
}

function openAiError(status: number, value: unknown): Error {
  const message = isRecord(value)
    && isRecord(value.error)
    && typeof value.error.message === "string"
    ? value.error.message
    : `OpenAI request failed with HTTP ${status}.`;
  return new Error(message);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
