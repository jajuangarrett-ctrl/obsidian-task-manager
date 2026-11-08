import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: mocks.request }));
import { DashboardTextSession, TEXT_SEARCH_TOOLS } from "./dashboard-text-session";
const response = (output: unknown[]) => ({ status: 200, json: { status: "completed", output } });
const call = (id = "c1", name = "find_tasks") => ({ type: "function_call", name, call_id: id, arguments: '{"query":"budget","status":"","offset":0}' });
const answer = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Budget summary" }] };
const ask = (session: DashboardTextSession, question = "What budget work remains?") => session.ask(question, "test-secret", "configured-backend", "dashboard-context");
beforeEach(() => mocks.request.mockReset());
describe("Responses advanced typed search", () => {
  it("uses the configured voice backend, same instructions/retrieval schemas, and iterative tool evidence", async () => {
    const execute = vi.fn(async () => ({ total: 1, tasks: [{ task_id: "a", title: "Budget" }] }));
    const session = new DashboardTextSession(execute);
    mocks.request.mockResolvedValueOnce(response([call()])).mockResolvedValueOnce(response([answer]));
    expect(await ask(session)).toBe("Budget summary");
    const body = JSON.parse(mocks.request.mock.calls[0][0].body);
    expect(body.model).toBe("configured-backend"); expect(body.instructions).toContain("dashboard-context");
    expect(body.tools).toEqual(TEXT_SEARCH_TOOLS); expect(body.tools.map((t: any) => t.name)).toEqual(["find_tasks", "read_task"]);
    expect(body.store).toBe(false); expect(body.tool_choice).toBe("required"); expect(body.input[0].content).toContain("budget");
    expect(execute).toHaveBeenCalledWith("find_tasks", call().arguments, "c1");
    expect(JSON.parse(mocks.request.mock.calls[1][0].body).input.at(-1).type).toBe("function_call_output");
    mocks.request.mockResolvedValueOnce(response([answer])); await ask(session, "Which is most urgent?");
    expect(JSON.parse(mocks.request.mock.calls[2][0].body).input).toContainEqual(answer);
    session.reset(); mocks.request.mockResolvedValueOnce(response([answer])); await ask(session);
    expect(JSON.parse(mocks.request.mock.calls[3][0].body).input).toHaveLength(1);
  });
  it("deduplicates repeated tool calls and blocks every mutation tool", async () => {
    const execute = vi.fn(async () => ({})); const session = new DashboardTextSession(execute);
    mocks.request.mockResolvedValueOnce(response([call(), call()])).mockResolvedValueOnce(response([answer]));
    await ask(session); expect(execute).toHaveBeenCalledTimes(1);
    mocks.request.mockResolvedValueOnce(response([call("write", "change_task")]));
    await expect(ask(session)).rejects.toThrow("unsupported search tool"); expect(execute).toHaveBeenCalledTimes(1);
  });
  it("discards late responses after cancellation and preserves successful history only", async () => {
    const execute = vi.fn(); const session = new DashboardTextSession(execute);
    let finish!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = ask(session); session.cancel(); finish(response([call()]));
    await expect(pending).rejects.toThrow("cancelled"); expect(execute).not.toHaveBeenCalled();
    mocks.request.mockResolvedValueOnce(response([answer])); await ask(session, "New question");
    expect(JSON.parse(mocks.request.mock.calls[1][0].body).input).toHaveLength(1);
  });
  it("handles missing credentials, HTTP errors, incomplete output, and bounded tool loops", async () => {
    const session = new DashboardTextSession(vi.fn(async () => ({})));
    await expect(session.ask("question", "", "model", "")).rejects.toThrow("API key"); expect(mocks.request).not.toHaveBeenCalled();
    mocks.request.mockResolvedValueOnce({ status: 429 }); await expect(ask(session)).rejects.toThrow("quota");
    mocks.request.mockResolvedValueOnce({ status: 200, json: { status: "incomplete", output: [answer] } }); await expect(ask(session)).rejects.toThrow("did not complete");
    mocks.request.mockResolvedValue(response([call()])); await expect(ask(session)).rejects.toThrow("step limit"); expect(mocks.request).toHaveBeenCalledTimes(10);
  });
});
