import { fail, json, readJson } from "@/lib/api";
import { store } from "@/lib/db";
import type { Mode, VitalsSourceKind } from "@/lib/types";

export async function POST(req: Request) {
  const body = await readJson<{ name?: string; mode?: Mode; vitals_source?: VitalsSourceKind }>(req);
  if (body.mode && !["hype", "winddown"].includes(body.mode)) return fail("mode must be hype or winddown");
  const room = await store.createRoom(body.mode ?? "hype", body.vitals_source ?? "live", body.name);
  return json(room, 201);
}
