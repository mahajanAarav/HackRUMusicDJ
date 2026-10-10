import { json, readJson } from "@/lib/api";
import { store } from "@/lib/db";
import type { VitalsSourceKind } from "@/lib/types";

export async function POST(req: Request) {
  const body = await readJson<{ name?: string; vitals_source?: VitalsSourceKind }>(req);
  const room = await store.createRoom(body.vitals_source ?? "live", body.name);
  return json(room, 201);
}
