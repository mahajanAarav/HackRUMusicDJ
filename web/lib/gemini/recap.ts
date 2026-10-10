import { GoogleGenAI } from "@google/genai";
import type { Store } from "../db/store";

/** Stretch: end-of-night recap grounded in the stored queue and impact scores. */
export async function generateRecap(store: Store, code: string): Promise<string> {
  const room = await store.getRoom(code);
  const queue = (await store.listQueue(code)).filter((q) => q.status === "played" || q.status === "skipped");
  const impacts = await store.listImpacts(code);
  const rows = queue.map((q) => {
    const i = impacts.find((x) => x.queue_id === q.id);
    return `${q.song} - ${q.artist} (${q.status}; impact ${i?.score ?? "n/a"}; ${q.reason})`;
  });
  if (!process.env.GEMINI_API_KEY || process.env.MOCK_LLM) {
    const best = impacts.filter((i) => i.score != null).sort((a, b) => b.score! - a.score!)[0];
    return `Night recap: ${rows.length} tracks played.${best ? ` Biggest mover: ${best.song} by ${best.artist} (arousal ${best.score}).` : ""}`;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
    contents: `Write a short, fun end-of-night recap (under 120 words) for a DJ set. Use only these facts; impact is the room's signed arousal change (-1..1, positive = pulse/breathing rose).\n${rows.join("\n")}`,
  });
  return res.text ?? "";
}
