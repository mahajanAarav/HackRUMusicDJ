import { store } from "@/lib/db";

/** Serves a guest's photo or voice note so the host screen can show it. Only inputs, never camera frames from pulse scans. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  try {
    const input = (await store.listInputs(code)).find((i) => i.id === id);
    if (!input?.data_b64) return new Response("not found", { status: 404 });
    return new Response(Buffer.from(input.data_b64, "base64"), { headers: { "Content-Type": input.mime ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
