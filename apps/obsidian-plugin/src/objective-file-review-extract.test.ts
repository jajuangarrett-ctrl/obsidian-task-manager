import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canExtractReviewFile, extractReviewSource, REVIEW_MAX_FILE_BYTES } from "./objective-file-review-extract";

function array(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer; }
function utf8(text: string): ArrayBuffer { return new TextEncoder().encode(text).buffer; }

function zip(entries: Array<[string, string]>, compressed = false, declaredSize?: number): ArrayBuffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [path, source] of entries) {
    const name = Buffer.from(path), bytes = Buffer.from(source);
    const payload = compressed ? deflateRawSync(bytes) : bytes;
    const method = compressed ? 8 : 0, checksum = crc32(bytes), size = declaredSize ?? bytes.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, payload);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50, 0);
    index.writeUInt16LE(method, 10);
    index.writeUInt32LE(checksum, 16);
    index.writeUInt32LE(payload.length, 20);
    index.writeUInt32LE(size, 24);
    index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(offset, 42);
    central.push(index, name);
    offset += header.length + name.length + payload.length;
  }
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50, 0);
  tail.writeUInt16LE(entries.length, 8);
  tail.writeUInt16LE(entries.length, 10);
  tail.writeUInt32LE(central.reduce((sum, item) => sum + item.length, 0), 12);
  tail.writeUInt32LE(offset, 16);
  return array(Buffer.concat([...local, ...central, tail]));
}

// Vitest is Node-only. The stub models the narrow inert DOM traversal API;
// native XML parsing is exercised separately in the Chromium synthetic smoke.
function xmlHarness() {
  const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parsed: string[] = [];
  vi.stubGlobal("DOMParser", class {
    parseFromString(xml: string) {
      parsed.push(xml);
      const nodes = [{ namespaceURI: word, localName: "p", textContent: null },
        { namespaceURI: word, localName: "t", textContent: "synthetic Word content" }];
      return {
        documentElement: { namespaceURI: word },
        getElementsByTagName: () => [],
        getElementsByTagNameNS: () => [{}],
        createTreeWalker: () => ({ nextNode: () => nodes.shift() ?? null }),
      };
    }
  });
  return parsed;
}
afterEach(() => vi.unstubAllGlobals());

describe("scoped review source extraction", () => {
  it("preserves the whole supported text including newlines and final sentinel", async () => {
    const text = "# Work\n" + "item\n".repeat(6500) + "final decision\n";
    expect(canExtractReviewFile(".MD")).toBe(true);
    expect(await extractReviewSource("MD", utf8(text))).toEqual({ kind: "text", text });
    expect(await extractReviewSource("csv", utf8("Column\nRow"))).toEqual({ kind: "text", text: "Column\nRow" });
  });

  it("handles a UTF-16 BOM and identifies empty or invalid binary-looking text", async () => {
    const le = array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Sample 北京", "utf16le")]));
    expect(await extractReviewSource("txt", le)).toEqual({ kind: "text", text: "Sample 北京" });
    expect(await extractReviewSource("md", utf8(" \n"))).toEqual({ kind: "excluded", reason: "empty" });
    expect(await extractReviewSource("md", array(Uint8Array.of(0x81)))).toEqual({ kind: "excluded", reason: "unreadable" });
    expect(await extractReviewSource("md", utf8("Prefix\0suffix"))).toEqual({ kind: "excluded", reason: "unreadable" });
  });

  it("refuses active HTML, unsupported PDF and oversized files or text instead of clipping", async () => {
    for (const extension of ["html", "pdf", "doc", "docm", "exe"]) {
      expect(canExtractReviewFile(extension)).toBe(false);
      expect(await extractReviewSource(extension, utf8("synthetic"))).toEqual({ kind: "excluded", reason: "unsupported" });
    }
    expect(await extractReviewSource("md", new ArrayBuffer(REVIEW_MAX_FILE_BYTES + 1))).toEqual({ kind: "excluded", reason: "too_large" });
    expect(await extractReviewSource("txt", utf8("x".repeat(200_001)))).toEqual({ kind: "excluded", reason: "too_large" });
  });

  it("keeps visible sender fields and whole plain EML body while dropping private Bcc and routing headers", async () => {
    const raw = "From: Actual Author <author@example.invalid>\r\nSender: sender@example.invalid\r\n"+
      "Reply-To: reply@example.invalid\r\nTo: Team\r\nCc: Visible Copy\r\nBcc: hidden@example.invalid\r\n"+
      "\tsecond-hidden@example.invalid\r\nResent-Bcc: third-hidden@example.invalid\r\n"+
      "Received: internal-address\r\nSubject: Action update\r\nContent-Type: text/plain; charset=UTF-8\r\n"+
      "\r\nLine 1, Reykjavík.\r\nWhole body, final line.\r\n";
    expect(canExtractReviewFile("EML")).toBe(true);
    expect(await extractReviewSource("eml", utf8(raw))).toEqual({
      kind: "text",
      text: "From: Actual Author <author@example.invalid>\nSender: sender@example.invalid\n"+
        "Reply-To: reply@example.invalid\nTo: Team\nCc: Visible Copy\nSubject: Action update\n\n"+
        "Line 1, Reykjavík.\r\nWhole body, final line.\r\n",
    });
  });

  it("decodes complete single plain email transfers and declines malformed or rich MIME", async () => {
    const prefix = "From: Example\nContent-Type: text/plain; charset=\"UTF-8\"\nContent-Transfer-Encoding: ";
    expect(await extractReviewSource("eml", utf8(prefix + "quoted-printable\n\nCaf=C3=A9 =\nends.")))
      .toEqual({ kind: "text", text: "From: Example\n\nCafé ends." });
    const base64 = Buffer.from("Café final").toString("base64");
    expect(await extractReviewSource("eml", utf8(prefix + "base64\n\n" + base64)))
      .toEqual({ kind: "text", text: "From: Example\n\nCafé final" });
    expect(await extractReviewSource("eml", utf8(prefix + "base64\n\nnot+valid!==")))
      .toEqual({ kind: "excluded", reason: "unreadable" });
    expect(await extractReviewSource("eml", utf8("From: Example\n\n")))
      .toEqual({ kind: "excluded", reason: "empty" });
    for (const header of [
      "Content-Type: text/html", "Content-Type: multipart/mixed; boundary=sample",
      "Content-Type: text/plain; name=attached.txt", "Content-Disposition: attachment",
      "Content-Transfer-Encoding: binary", "Content-Type: text/plain; charset=shift_jis",
    ]) expect(await extractReviewSource("eml", utf8("From: Example\n" + header + "\n\nnot sent")))
      .toEqual({ kind: "excluded", reason: "unsupported" });
  });

  it("safely opens the selected Word text part, including deflated XML, not relationships", async () => {
    const parsed = xmlHarness();
    const source = '<w:document><w:body><w:p><w:t>Hello</w:t></w:p></w:body></w:document>';
    for (const deflate of [false, true]) {
      expect(await extractReviewSource("docx", zip([
        ["word/document.xml", source],
        ["word/_rels/document.xml.rels", "this must not be read or parsed"],
      ], deflate))).toEqual({kind: "text", text: "synthetic Word content"});
    }
    expect(parsed).toEqual([source, source]);
  });

  it("rejects malicious or unsupported packages before handing text to XML parsing", async () => {
    const parsed = xmlHarness();
    const name = "word/document.xml";
    expect(await extractReviewSource("docx", utf8("not zip"))).toEqual({kind:"excluded", reason:"unreadable"});
    expect(await extractReviewSource("docx", zip([[name, "bad"], [name, "duplicate"]]))).toEqual({kind:"excluded", reason:"unreadable"});
    expect(await extractReviewSource("docx", zip([[name, '<!DOCTYPE d SYSTEM "https://example.invalid"><d/>']]))).toEqual({kind:"excluded", reason:"unsupported"});
    expect(await extractReviewSource("docx", zip([[name, "<d/>"], ["word/media/a.jpg", "synthetic"]]))).toEqual({kind:"excluded", reason:"unsupported"});
    expect(await extractReviewSource("docx", zip([[name, "<d/>"]], true, 3 * 1024 * 1024))).toEqual({kind:"excluded", reason:"too_large"});
    expect(await extractReviewSource("docx", zip([[name, "<d/>"]], true, 1))).toEqual({kind:"excluded", reason:"unreadable"});
    expect(parsed).toEqual([]);
  });
});
