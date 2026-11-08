import { requestUrl } from "obsidian";
import { backendInstructions, LIVE_TOOLS } from "./live-tools";

export const TEXT_SEARCH_TOOLS = LIVE_TOOLS.filter(tool => ["find_tasks", "read_task"].includes(tool.name));
const cancelled = () => new Error("Search cancelled. Any request already sent may still incur API charges.");
/** Text uses the same Responses backend and retrieval tools as voice, without audio transport. */
export class DashboardTextSession {
  private history: Record<string, unknown>[] = [];
  private generation = 0;
  private busy = false;
  constructor(private execute: (name: string, args: string, id: string) => Promise<unknown>) {}
  cancel(): void { this.generation++; this.busy = false; }
  reset(): void { this.cancel(); this.history = []; }
  async ask(question: string, apiKey: string, model: string, context: string): Promise<string> {
    if (this.busy) throw new Error("Wait for the current search to finish.");
    if (!question.trim() || question.length > 4000) throw new Error("Enter a question of up to 4,000 characters.");
    if (!apiKey.trim()) throw new Error("Add your OpenAI API key in FJG Task Manager settings.");
    if (JSON.stringify(this.history).length > 350000) throw new Error("Start a new search conversation before continuing.");
    this.busy = true;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    const input = [...this.history, { role: "user", content: question.trim() }];
    const calls = new Map<string, { name: string; args: string; result: unknown }>();
    try {
      for (let round = 0; round < 8; round++) {
        if (!current()) throw cancelled();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const response = await Promise.race([
          requestUrl({ url: "https://api.openai.com/v1/responses", method: "POST", throw: false,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, store: false, instructions: `${backendInstructions(context)}\nThis is a typed, read-only search conversation. Search/read before answering task-data questions. Do not change tasks. Give a useful answer to the question using returned evidence, mention coverage limitations, and ask clarifying questions when needed.`,
              tools: TEXT_SEARCH_TOOLS, tool_choice: round === 0 ? "required" : "auto", parallel_tool_calls: false, max_output_tokens: 1800, input }) }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Search timed out. No automatic retry was sent; a submitted request may still incur API charges.")), 60000); })
        ]).finally(() => clearTimeout(timer));
        if (!current()) throw cancelled();
        if (response.status >= 400) throw new Error(response.status === 401 ? "Check your saved OpenAI API key." : response.status === 429 ? "Check your OpenAI quota or try again later." : `Search failed (HTTP ${response.status}). Check your API model access and network.`);
        const data = response.json;
        if (data?.status !== "completed" || !Array.isArray(data.output)) throw new Error("OpenAI did not complete this search. Try a narrower question.");
        const output = data.output as Record<string, any>[];
        const toolCalls = output.filter(item => item.type === "function_call");
        input.push(...output);
        if (!toolCalls.length) {
          const answer = output.filter(item => item.type === "message").flatMap(item => Array.isArray(item.content) ? item.content : [])
            .filter(item => item.type === "output_text" || item.type === "refusal").map(item => item.text || item.refusal || "").join("\n").trim();
          if (!answer) throw new Error("OpenAI returned no answer. Try a narrower question.");
          this.history = input;
          return answer;
        }
        for (const call of toolCalls) {
          if (!current()) throw cancelled();
          if (!TEXT_SEARCH_TOOLS.some(tool => tool.name === call.name) || typeof call.call_id !== "string" || typeof call.arguments !== "string") throw new Error("OpenAI requested an unsupported search tool. No changes were made.");
          let saved = calls.get(call.call_id);
          if (saved && (saved.name !== call.name || saved.args !== call.arguments)) throw new Error("OpenAI returned conflicting search calls. Try again.");
          if (!saved) {
            let result: unknown;
            try { result = await this.execute(call.name, call.arguments, call.call_id); }
            catch { result = { error: "Could not read the requested objective. Refresh the search or use a different query." }; }
            if (!current()) throw cancelled();
            saved = { name: call.name, args: call.arguments, result }; calls.set(call.call_id, saved);
          }
          input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(saved.result) });
        }
      }
      throw new Error("Search reached its step limit. Try a more specific question.");
    } catch (error) {
      if (!current()) throw cancelled();
      if (error instanceof Error && !/fetch|network|request/i.test(error.message)) throw error;
      throw new Error("Could not reach OpenAI. Check your connection and try again.");
    } finally { if (current()) this.busy = false; }
  }
}
