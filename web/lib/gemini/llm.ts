import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import { functionDeclarations } from "./tools";

export interface LlmTurn {
  /** The model's content, appended to history verbatim (keeps thought signatures intact). */
  content: Content;
  functionCalls: FunctionCall[];
  text?: string;
}

export interface LlmClient {
  generate(req: { system: string; contents: Content[] }): Promise<LlmTurn>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiLlm implements LlmClient {
  /** Free tier allows ~5 requests/min. On 429, wait the server-suggested delay and retry (up to 2x). */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/prepayment credits/i.test(msg)) throw new Error("RATE_LIMITED: Gemini billing has no prepaid credits left. Add credits at ai.studio/projects, or use a key from a free-tier project.");
        const limited = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
        const secs = Number(/retry in ([\d.]+)s/i.exec(msg)?.[1] ?? /"retryDelay":"(\d+)s"/.exec(msg)?.[1] ?? 20);
        if (!limited || attempt >= 1 || secs > 12) {
          throw limited ? new Error(`RATE_LIMITED: Gemini quota hit (free tier = 5 requests/min). Enable billing or wait ${Math.ceil(secs)}s.`) : e;
        }
        await sleep((secs + 1) * 1000);
      }
    }
  }

  private ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  private model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

  async generate({ system, contents }: { system: string; contents: Content[] }): Promise<LlmTurn> {
    const res = await this.withRetry(() =>
      this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: functionDeclarations as never }],
          temperature: 0.8,
        },
      }),
    );
    const functionCalls = res.functionCalls ?? [];
    return {
      content: res.candidates?.[0]?.content ?? { role: "model", parts: [] },
      functionCalls,
      text: functionCalls.length ? undefined : res.text,
    };
  }
}
