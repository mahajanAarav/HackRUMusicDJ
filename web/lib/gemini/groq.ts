import type { Content, FunctionCall } from "@google/genai";
import type { LlmClient, LlmTurn } from "./llm";
import { functionDeclarations } from "./tools";

/** Convert the agent's Gemini-style history into OpenAI-style chat messages (what Groq speaks). */
export function toGroqMessages(system: string, contents: Content[]) {
  const msgs: Record<string, unknown>[] = [{ role: "system", content: system }];
  let callN = 0;
  const pending: { id: string; name: string }[] = [];
  for (const c of contents) {
    const parts = c.parts ?? [];
    if (c.role === "model") {
      const text = parts.map((p) => p.text ?? "").join("");
      const tool_calls = parts
        .filter((p) => p.functionCall)
        .map((p) => {
          const id = `call_${callN++}`;
          pending.push({ id, name: p.functionCall!.name! });
          return { id, type: "function", function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) } };
        });
      msgs.push({ role: "assistant", content: text || null, ...(tool_calls.length ? { tool_calls } : {}) });
    } else if (parts.some((p) => p.functionResponse)) {
      for (const p of parts.filter((x) => x.functionResponse)) {
        const i = pending.findIndex((x) => x.name === p.functionResponse!.name);
        const id = i >= 0 ? pending.splice(i, 1)[0].id : "call_unknown";
        msgs.push({ role: "tool", tool_call_id: id, content: JSON.stringify(p.functionResponse!.response) });
      }
    } else {
      // Groq's text models cannot see photos or hear audio, so say so instead of silently dropping them.
      const text = parts.map((p) => (p.inlineData ? "[media attached: not visible to this model]" : (p.text ?? ""))).join("\n");
      msgs.push({ role: "user", content: text });
    }
  }
  return msgs;
}

/** Each Groq model has its own free per-minute token budget, so spill over to the next when one is full. */
const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

export class GroqLlm implements LlmClient {
  async generate({ system, contents }: { system: string; contents: Content[] }): Promise<LlmTurn> {
    const preferred = process.env.GROQ_MODEL;
    const models = preferred ? [preferred, ...MODELS.filter((m) => m !== preferred)] : MODELS;
    let lastErr = "";
    for (const model of models) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: toGroqMessages(system, contents),
          tools: functionDeclarations.map((f) => ({ type: "function", function: { name: f.name, description: f.description, parameters: f.parametersJsonSchema } })),
          tool_choice: "auto",
          temperature: 0.7,
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}), // fewer hidden reasoning tokens
        }),
      });
      if (res.status === 429) { lastErr = (await res.text()).slice(0, 160); continue; }
      if (res.status === 400) {
        const body = await res.text();
        if (body.includes("tool_use_failed")) { lastErr = "tool_use_failed"; continue; } // malformed tool call: try the next model
        throw new Error(`Groq error 400 (${model}): ${body.slice(0, 300)}`);
      }
      if (!res.ok) throw new Error(`Groq error ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[]; usage?: { total_tokens: number } };
      if (process.env.DEBUG_LLM) console.log(`[groq ${model}] tokens=${data.usage?.total_tokens}`);
      const msg = data.choices[0].message;
      const functionCalls: FunctionCall[] = (msg.tool_calls ?? []).map((t) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(t.function.arguments || "{}"); } catch {}
        return { name: t.function.name, args };
      });
      const parts = [...(msg.content ? [{ text: msg.content }] : []), ...functionCalls.map((fc) => ({ functionCall: fc }))];
      return { content: { role: "model", parts }, functionCalls, text: functionCalls.length ? undefined : (msg.content ?? undefined) };
    }
    throw new Error(`RATE_LIMITED: Groq unavailable on every model. ${lastErr}`);
  }
}
