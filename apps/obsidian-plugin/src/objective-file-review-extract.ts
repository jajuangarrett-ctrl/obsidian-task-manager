// Extract only bounded document text. No network, document renderer, Office
// macros, XML relationships, or embedded files are opened.
export const REVIEW_MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 200_000;
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export type ExtractedReviewSource =
  | { kind: "text"; text: string }
  | { kind: "excluded"; reason: "unsupported" | "empty" | "unreadable" | "too_large" };

type Reason = Extract<ExtractedReviewSource, { kind: "excluded" }>["reason"];
class NotExtractable extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}

const TEXT_TYPES = new Set(["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml"]);
function fileExtension(value: string): string {
  return value.replace(/^\./, "").toLowerCase();
}

export function canExtractReviewFile(extension: string): boolean {
  const normalized = fileExtension(extension);
  return TEXT_TYPES.has(normalized) || normalized === "docx" || normalized === "eml";
}

function textResult(text: string): ExtractedReviewSource {
  if (text.length > MAX_TEXT_CHARACTERS) throw new NotExtractable("too_large");
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text)) throw new NotExtractable("unreadable");
  return text.trim() ? { kind: "text", text } : { kind: "excluded", reason: "empty" };
}

export async function extractReviewSource(extension: string, bytes: ArrayBuffer): Promise<ExtractedReviewSource> {
  const normalized = fileExtension(extension);
  if (!canExtractReviewFile(normalized)) return { kind: "excluded", reason: "unsupported" };
  if (bytes.byteLength > REVIEW_MAX_FILE_BYTES) return { kind: "excluded", reason: "too_large" };
  if (!bytes.byteLength) return { kind: "excluded", reason: "empty" };
  try {
    if (normalized === "docx") return textResult(await extractWord(bytes));
    if (normalized === "eml") return textResult(extractPlainEmail(bytes));
    const prefix = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    const encoding = prefix[0] === 0xff && prefix[1] === 0xfe ? "utf-16le" :
      prefix[0] === 0xfe && prefix[1] === 0xff ? "utf-16be" : "utf-8";
    return textResult(new TextDecoder(encoding, { fatal: true }).decode(bytes));
  } catch (error) {
    return { kind: "excluded", reason: error instanceof NotExtractable ? error.reason : "unreadable" };
  }
}

const VISIBLE_MAIL_FIELDS = new Set([
  "from", "sender", "reply-to", "to", "cc", "subject", "date", "message-id", "in-reply-to", "references",
  "resent-from", "resent-sender", "resent-to", "resent-cc", "resent-date", "resent-message-id",
]);

function extractPlainEmail(bytes: ArrayBuffer): string {
  // Find the separator in bytes. Decode the visible headers and body
  // independently, using strict UTF-8 and enforcing a declared ASCII charset.
  const raw = new Uint8Array(bytes);
  let end = -1, bodyStart = -1;
  for (let i = 0; i < raw.length - 1 && i <= 64 * 1024; i++) {
    if (raw[i] !== 10) continue;
    if (raw[i + 1] === 10) { end = i; bodyStart = i + 2; break; }
    if (raw[i + 1] === 13 && raw[i + 2] === 10) {
      end = i > 0 && raw[i - 1] === 13 ? i - 1 : i;
      bodyStart = i + 3; break;
    }
  }
  if (end < 0) throw new NotExtractable(raw.length > 64 * 1024 ? "too_large" : "unreadable");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const fields: Array<{ name: string; value: string; original: string[] }> = [];
  for (const line of decoder.decode(raw.subarray(0, end)).split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      const previous = fields.at(-1);
      if (!previous) throw new NotExtractable("unreadable");
      previous.original.push(line);
      previous.value += " " + line.trim();
      continue;
    }
    const match = /^([!-9;-~]+):([\s\S]*)$/.exec(line);
    if (!match || /[\x00-\x08\x0a-\x1f\x7f]/.test(line)) throw new NotExtractable("unreadable");
    fields.push({ name: match[1].toLowerCase(), value: match[2].trim(), original: [line] });
  }
  function unique(name: string): string | undefined {
    const hits = fields.filter((field) => field.name === name);
    if (hits.length > 1) throw new NotExtractable("unreadable");
    return hits[0]?.value.toLowerCase();
  }
  const visible = fields.filter((field) => VISIBLE_MAIL_FIELDS.has(field.name));
  if (!visible.length) throw new NotExtractable("unreadable");
  const disposition = unique("content-disposition"), mime = unique("mime-version");
  if ((disposition && disposition !== "inline") || (mime && mime !== "1.0")) throw new NotExtractable("unsupported");
  const type = unique("content-type") ?? "text/plain";
  const match = /^text\/plain(?:\s*;\s*charset\s*=\s*(?:"(utf-8|us-ascii)"|(utf-8|us-ascii)))?$/i.exec(type);
  if (!match) throw new NotExtractable("unsupported");
  const charset = match[1] ?? match[2];
  const transfer = unique("content-transfer-encoding") ?? "8bit";
  let body = raw.subarray(bodyStart);
  if (transfer === "base64" || transfer === "quoted-printable") {
    const encoded = decoder.decode(body);
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(encoded)) throw new NotExtractable("unreadable");
    if (transfer === "base64") {
      const compact = encoded.replace(/[ \t\r\n]/g, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact))
        throw new NotExtractable("unreadable");
      body = Uint8Array.from(atob(compact), (value) => value.charCodeAt(0));
    } else {
      const result = new Uint8Array(encoded.length);
      let size = 0;
      for (let i = 0; i < encoded.length; i++) {
        if (encoded[i] !== "=") { result[size++] = encoded.charCodeAt(i); continue; }
        if (encoded[i + 1] === "\n") { i += 1; continue; }
        if (encoded.slice(i + 1, i + 3) === "\r\n") { i += 2; continue; }
        const pair = encoded.slice(i + 1, i + 3);
        if (!/^[0-9a-f]{2}$/i.test(pair)) throw new NotExtractable("unreadable");
        result[size++] = Number.parseInt(pair, 16);
        i += 2;
      }
      body = result.subarray(0, size);
    }
  } else if (transfer !== "7bit" && transfer !== "8bit") {
    throw new NotExtractable("unsupported");
  }
  if ((charset === "us-ascii" || transfer === "7bit") && body.some((value) => value > 127))
    throw new NotExtractable("unreadable");
  const message = decoder.decode(body);
  if (!message.trim()) throw new NotExtractable("empty");
  return visible.flatMap((field) => field.original).join("\n") + "\n\n" + message;
}

type ZipPart = { name: string; method: number; crc: number; size: number; span: Uint8Array<ArrayBuffer> };

function readZipParts(buffer: ArrayBuffer): ZipPart[] {
  const data = new DataView(buffer);
  const u16 = (i: number) => data.getUint16(i, true);
  const u32 = (i: number) => data.getUint32(i, true);
  let end = buffer.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== buffer.byteLength)) end--;
  if (end < minimum || u16(end + 4) || u16(end + 6)) throw new NotExtractable("unreadable");
  const count = u16(end + 10);
  if (count === 65535 || count > MAX_ARCHIVE_ENTRIES) throw new NotExtractable("too_large");
  const central = u32(end + 16), centralSize = u32(end + 12);
  if (u16(end + 8) !== count || central + centralSize !== end) throw new NotExtractable("unreadable");
  const parts: ZipPart[] = [];
  const names = new Set<string>();
  let cursor = central;
  const ascii = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw new NotExtractable("unreadable");
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const packed = u32(cursor + 20), size = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32);
    const local = u32(cursor + 42), next = cursor + 46 + nameLength + extra + comment;
    if (next > end || nameLength > 1024 || local + 30 > central || u32(local) !== 0x04034b50)
      throw new NotExtractable("unreadable");
    if (flags & 1 || u16(cursor + 34) || !(method === 0 || method === 8)) throw new NotExtractable("unsupported");
    const name = ascii.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    if (!name || !/^[\x20-\x7e]+$/.test(name) || name.includes("\\") || name.startsWith("/") ||
      name.split("/").some((part) => part === ".." || part === ".") || names.has(name.toLowerCase()))
      throw new NotExtractable("unreadable");
    names.add(name.toLowerCase());
    const localNameLength = u16(local + 26), start = local + 30 + localNameLength + u16(local + 28);
    if (localNameLength !== nameLength || start + packed > central || u16(local + 6) !== flags ||
      u16(local + 8) !== method || ascii.decode(new Uint8Array(buffer, local + 30, localNameLength)) !== name ||
      (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== packed || u32(local + 22) !== size)) ||
      (method === 0 && packed !== size)) throw new NotExtractable("unreadable");
    if (/^word\/(?:media|embeddings|activeX|charts|diagrams)\//i.test(name) ||
      /^word\/vbaProject\.bin$/i.test(name)) throw new NotExtractable("unsupported");
    if (/^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(name)) {
      parts.push({ name, method, crc, size, span: new Uint8Array(buffer, start, packed) });
    }
    cursor = next;
  }
  if (cursor !== end || !parts.some(({ name }) => name === "word/document.xml")) throw new NotExtractable("unreadable");
  return parts;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

async function xmlPart(part: ZipPart): Promise<string> {
  if (part.size > MAX_XML_BYTES) throw new NotExtractable("too_large");
  let bytes: Uint8Array<ArrayBuffer> = part.span;
  if (part.method === 8) {
    if (typeof DecompressionStream === "undefined") throw new NotExtractable("unsupported");
    let decoder: DecompressionStream;
    try { decoder = new DecompressionStream("deflate-raw"); }
    catch { throw new NotExtractable("unsupported"); }
    const reader = new Blob([part.span]).stream().pipeThrough(decoder).getReader();
    bytes = new Uint8Array(part.size);
    let total = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (total + chunk.value.byteLength > MAX_XML_BYTES) throw new NotExtractable("too_large");
        if (total + chunk.value.byteLength > part.size) throw new NotExtractable("unreadable");
        bytes.set(chunk.value, total);
        total += chunk.value.byteLength;
      }
      if (total !== part.size) throw new NotExtractable("unreadable");
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  if (crc32(bytes) !== part.crc) throw new NotExtractable("unreadable");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new NotExtractable("unsupported");
  return xml;
}

async function extractWord(buffer: ArrayBuffer): Promise<string> {
  const parts = readZipParts(buffer);
  if (parts.reduce((total, item) => total + item.size, 0) > MAX_XML_BYTES) throw new NotExtractable("too_large");
  if (typeof DOMParser === "undefined") throw new NotExtractable("unsupported");
  const contents: string[] = [];
  let length = 0;
  parts.sort((a, b) => a.name === "word/document.xml" ? -1 : b.name === "word/document.xml" ? 1 :
    a.name.localeCompare(b.name, "en", { numeric: true }));
  for (const part of parts) {
    const document = new DOMParser().parseFromString(await xmlPart(part), "application/xml");
    if (!document.documentElement || document.getElementsByTagName("parsererror").length)
      throw new NotExtractable("unreadable");
    if (document.documentElement.namespaceURI !== WORD_NS) throw new NotExtractable("unsupported");
    if (part.name === "word/document.xml" && !document.getElementsByTagNameNS(WORD_NS, "body").length)
      throw new NotExtractable("unreadable");
    const walker = document.createTreeWalker(document.documentElement, 1 /* SHOW_ELEMENT */);
    const fragment: string[] = [];
    for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
      if (node.namespaceURI === "http://schemas.openxmlformats.org/markup-compatibility/2006" && node.localName === "AlternateContent")
        throw new NotExtractable("unsupported");
      if (node.namespaceURI === "http://schemas.openxmlformats.org/officeDocument/2006/math")
        throw new NotExtractable("unsupported");
      if (node.namespaceURI !== WORD_NS) continue;
      if (["altChunk", "drawing", "pict", "object", "ins", "del", "moveFrom", "moveTo", "vanish", "webHidden"].includes(node.localName))
        throw new NotExtractable("unsupported");
      const text = (node.localName === "t" ? node.textContent : node.localName === "p" || node.localName === "br" ||
        node.localName === "cr" ? "\n" : node.localName === "tab" ? "\t" : null) || "";
      if (text) {
        length += text.length;
        if (length > MAX_TEXT_CHARACTERS) throw new NotExtractable("too_large");
        fragment.push(text);
      }
    }
    const text = fragment.join("").trim();
    if (text) contents.push(part.name === "word/document.xml" ? text : `[${part.name.split("/").pop()}]\n${text}`);
  }
  return contents.join("\n\n");
}
