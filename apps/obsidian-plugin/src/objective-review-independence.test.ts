import { describe, expect, it, vi } from "vitest";
import { ObjectiveFileReviewService } from "./objective-file-review";

type Target = { id: string; observedPath: string };
const target: Target = { id: "synthetic-task-A", observedPath: "Inbox/Tasks/Private synthetic A/task.md" };
const second: Target = { id: "synthetic-task-B", observedPath: "Inbox/Tasks/Other synthetic B/task.md" };
const title = "Local-only scene logistics";
const privateOwner = "Local-only record owner";
const privateUpdate = "Local-only journal statement";
const baseFile = "charter.md";
const costFile = "menu.txt";
const baseRaw = "RAW-SCENE-100: The team intends to open a cafe in September.";
const costRaw = "RAW-MENU-210: Menu approval is pending.";
const alternateRaw = "RAW-SCENE-300: The team intends to open a cafe in November.";
const archiveRaw = "RAW-BETA-400: The unrelated objective is to move a piano.";
const baseInsight = "SYNTHETIC-FINDING-A: The cafe was planned for September.";
const costInsight = "SYNTHETIC-FINDING-C: Menu sign-off is a dependency.";
const fact = (text: string, evidence: string[]) => ({kind: "fact", text, evidence});
const simpleReport = (citations: Array<[string, string]>) => ({
  goal: citations.slice(0, 1).map(([path, text]) => fact(text, [path])),
  status: citations.map(([path, text]) => fact(text, [path])),
  updates: [], analysis: [], nextSteps: [], blockers: [], decisions: [], gaps: []
});
type FakeFile = {relativePath: string; extension: string; size: number; revision: string};
const binary = (value: string) => new TextEncoder().encode(value).buffer;
// A small, self-contained PDF with one blank page plus an ASCII comment spanning the base64 chunk boundary.
function fixturePdf(): string {
  let output = "%PDF-1.4\n%" + "SYNTHETIC".repeat(1100) + "\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>"
  ];
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(output.length); output += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  return output + "xref\n0 4\n0000000000 65535 f \n" +
    offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

function fixture() {
  let sequence = 0;
  const sources = new Map<string, Map<string, {raw: string; revision: string}>>();
  const stored = new Map<string, string>();
  const put = (target: Target, path: string, raw: string) => {
    if (!sources.has(target.id)) sources.set(target.id, new Map());
    sources.get(target.id)!.set(path, {raw, revision: String(++sequence)});
  };
  const take = (target: Target, path: string) => sources.get(target.id)?.delete(path);
  put(target, baseFile, baseRaw); put(second, "other.md", archiveRaw);
  let citations: Array<[string, string]> = [[baseFile, baseInsight]];
  let ids = new Map<string, string>();
  const buildReply = () => simpleReport(citations.map(([path, text]) => [ids.get(path) ?? path, text]));
  let fail = false;
  const posted: {url: string; body: string}[] = [];
  const getKey = vi.fn(() => "fixture-key-not-real");
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    posted.push({url, body: String(init.body)});
    return new Response(JSON.stringify(fail ? {error: {message: "Synthetic service failure"}} : {
      status: "completed",
      output: [{type: "message", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(buildReply())}]}]
    }), {status: fail ? 503 : 200, headers: {"content-type": "application/json"}});
  });
  const workspace = {
    snapshot: vi.fn(async (scope: Target) => ({
      title, scopeKey: scope.id,
      context: {title, status: "waiting", due: "2099-05-30", owner: privateOwner, updates: [{timestamp: "2099-01-01", actor: "Local-only actor", text: privateUpdate}]},
      files: [...sources.get(scope.id)!].map(([path, file]): FakeFile => ({
        relativePath: path, extension: path.split(".").pop()!, size: binary(file.raw).byteLength, revision: file.revision
      }))
    })),
    readSource: vi.fn(async (scope: Target, file: FakeFile) => binary(sources.get(scope.id)!.get(file.relativePath)!.raw)),
    load: vi.fn(async (scope: Target) => stored.get(scope.id) ?? null),
    save: vi.fn(async (scope: Target, expected: string | null, next: string) => {
      if ((stored.get(scope.id) ?? null) !== expected) throw Error("Fixture detected a conflicting write");
      stored.set(scope.id, next);
    })
  };
  const service = new ObjectiveFileReviewService(workspace, getKey, transport);
  const prepare = async (scope = target) => {
    const plan = await service.prepare(scope);
    ids = new Map(plan.sources.map(({path, id}) => [path, id]));
    return plan;
  };
  return {service, posted, getKey, workspace, stored, put, take, prepare,
    run: async (scope = target) => service.run(await prepare(scope)),
    answer: (evidence: Array<[string, string]>) => { citations = evidence; },
    fail: () => { fail = true; }
  };
}

describe("objective review independent integration, synthetic vault and in-memory HTTP only", () => {
  it("previews locally and never sends record metadata, raw text from a second objective, paths, or secrets in the request JSON", async () => {
    const f = fixture();
    const plan = await f.prepare();
    expect(f.posted).toHaveLength(0);
    expect(f.getKey).not.toHaveBeenCalled();
    await f.service.run(plan);
    expect(f.posted).toHaveLength(1);
    const {url, body} = f.posted[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toContain(baseRaw);
    for (const local of [title, target.id, target.observedPath, "2099-05-30", privateOwner, privateUpdate, archiveRaw, "fixture-key-not-real"]) {
      expect(body).not.toContain(local);
    }
    const request = JSON.parse(body);
    expect(request.store).toBe(false);
    expect(request.previous_response_id).toBeUndefined();
    expect(request.tools ?? []).toEqual([]);
    expect(f.stored.get(target.id)).not.toContain(baseRaw);
    expect(f.stored.has(second.id)).toBe(false);
  });

  it("asks for evidence-grounded decision support, not just a recap", async () => {
    const f = fixture();
    await f.run();
    const request = JSON.parse(f.posted[0].body);
    const prompt = request.input.find((row: {role: string}) => row.role === "developer").content[0].text;
    expect(prompt).toMatch(/conflict|contradict/i);
    expect(prompt).toMatch(/across sources|cross.source|across files/i);
    expect(prompt).toMatch(/dependenc/i);
    expect(prompt).toMatch(/implication|tradeoff/i);
    expect(prompt).toMatch(/uncertain|missing evidence|open question/i);
    expect(prompt).toMatch(/prioriti|most valuable next actions first/i);
    expect(prompt).toMatch(/never invent|do not invent/i);
    expect(prompt).toMatch(/inferen/i);
    expect(prompt).toMatch(/cit(e|ation)/i);
    const schema = request.text.format.schema;
    expect(schema.required).toEqual(expect.arrayContaining(["analysis", "nextSteps", "decisions", "gaps"]));
    expect(schema.properties.nextSteps.items.required).toEqual(expect.arrayContaining(["evidence", "rationale"]));
    expect(request.reasoning.effort).toBe("medium");
  });

  it("view and unchanged review make no request; new files send only their contents and the existing synthesis", async () => {
    const f = fixture();
    await f.run();
    await f.service.view(target);
    const prior = f.stored.get(target.id);
    const count = f.posted.length;
    const unchanged = await f.service.prepare(target);
    expect(unchanged.willContactOpenAI).toBe(false);
    await f.service.run(unchanged);
    expect(f.posted).toHaveLength(count);
    expect(f.stored.get(target.id)).toBe(prior);

    f.put(target, costFile, costRaw);
    f.answer([[baseFile, baseInsight], [costFile, costInsight]]);
    await f.run();
    const delta = f.posted.at(-1)!.body;
    expect(delta).toContain(costRaw);
    expect(delta).toContain(baseInsight);
    expect(delta).not.toContain(baseRaw);
    expect(delta).not.toContain(archiveRaw);
  });

  it("view opens the last successful local review even when the current source collection cannot be scanned", async () => {
    const f = fixture();
    await f.run();
    f.workspace.snapshot.mockClear().mockRejectedValue(Error("Fixture source collection unavailable"));
    f.workspace.readSource.mockClear();
    f.getKey.mockClear();
    const posted = f.posted.length;
    const saved = await f.service.view(target);
    expect(saved?.report.goal[0].text).toBe(baseInsight);
    expect(f.workspace.snapshot).not.toHaveBeenCalled();
    expect(f.workspace.readSource).not.toHaveBeenCalled();
    expect(f.getKey).not.toHaveBeenCalled();
    expect(f.posted).toHaveLength(posted);
  });

  it("sends the entire listed synthetic PDF once as low-detail file input, then reuses prior findings without sending PDF bytes", async () => {
    const f = fixture(), path = "contracts/plan.pdf", pdf = fixturePdf();
    f.put(target, path, pdf);
    f.put(target, "broken.pdf", "This is not a PDF.");
    f.answer([[path, "One-page plan was included."]]);
    const plan = await f.prepare();
    expect(plan.toSend).toContain(path);
    expect(plan.sources).toContainEqual(expect.objectContaining({path: "broken.pdf", state: "unreadable"}));
    await f.service.run(plan);
    const userParts = JSON.parse(f.posted[0].body).input.find((m: {role: string}) => m.role === "user").content;
    const files = userParts.filter((part: {type: string}) => part.type === "input_file");
    const source = plan.sources.find(source => source.path === path)!;
    expect(files).toEqual([expect.objectContaining({
      type: "input_file", detail: "low", filename: source.id + ".pdf",
      file_data: "data:application/pdf;base64," + Buffer.from(pdf).toString("base64")
    })]);
    expect(f.stored.get(target.id)).not.toContain("data:application/pdf");
    f.put(target, costFile, costRaw);
    await f.run();
    const next = f.posted.at(-1)!.body;
    expect(next).toContain("One-page plan was included.");
    expect(next).not.toContain("data:application/pdf;base64,");
  });

  it("replacing a file retires its obsolete conclusions and deleting a second source cannot leak its earlier findings", async () => {
    const f = fixture();
    f.put(target, costFile, costRaw);
    f.answer([[baseFile, baseInsight], [costFile, costInsight]]);
    await f.run();
    f.put(target, baseFile, alternateRaw);
    f.take(target, costFile);
    f.answer([[baseFile, "The cafe is now planned for November."]]);
    await f.run();
    const delta = f.posted.at(-1)!.body;
    expect(delta).toContain(alternateRaw);
    for (const obsolete of [baseRaw, baseInsight, costRaw, costInsight]) expect(delta).not.toContain(obsolete);
    expect(f.stored.get(target.id)).not.toContain(baseInsight);
    expect(f.stored.get(target.id)).not.toContain(costInsight);
  });

  it("does not send new contents that appeared after the consent preview", async () => {
    const f = fixture();
    const oldPlan = await f.prepare();
    f.put(target, baseFile, alternateRaw);
    await expect(f.service.run(oldPlan)).rejects.toThrow();
    expect(f.posted).toHaveLength(0);
    expect(f.stored.has(target.id)).toBe(false);
  });

  it("a copied saved review cannot introduce objective A's findings into objective B", async () => {
    const f = fixture();
    await f.run();
    f.stored.set(second.id, f.stored.get(target.id)!); // simulate an incorrectly copied local review file
    f.answer([["other.md", "The piano needs moving."]]);
    try { await f.run(second); } catch { /* rejecting an invalid prior file is also safe */ }
    for (const {body} of f.posted.slice(1)) {
      expect(body).not.toContain(baseRaw);
      expect(body).not.toContain(baseInsight);
      expect(body).not.toContain(baseFile);
    }
  });

  it("a claimed finding unsupported by the included source set cannot be stored as evidence", async () => {
    const f = fixture();
    f.answer([["not-in-this-objective.md", "Unverifiable source assertion"]]);
    try { await f.run(); } catch { /* rejecting the entire response is also safe */ }
    expect(f.stored.get(target.id) ?? "").not.toContain("Unverifiable source assertion");
  });

  it("an unchanged filename without surviving evidence cannot support a new model claim", async () => {
    const f = fixture();
    f.put(target, costFile, costRaw);
    // The first review did not draw any conclusion about the menu.
    f.answer([[baseFile, baseInsight]]);
    await f.run();
    const previous = f.stored.get(target.id);
    f.put(target, baseFile, alternateRaw);
    f.answer([[costFile, "This claim is based on a filename alone."]]);
    await expect(f.run()).rejects.toThrow();
    expect(f.posted.at(-1)!.body).not.toContain(costRaw);
    expect(f.stored.get(target.id)).toBe(previous);
  });

  it("a failed refresh preserves the previous successful record", async () => {
    const f = fixture();
    await f.run();
    const prior = f.stored.get(target.id);
    f.put(target, baseFile, alternateRaw);
    f.fail();
    await expect(f.run()).rejects.toThrow();
    expect(f.stored.get(target.id)).toBe(prior);
  });
});
