import { json, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { generateRecap } from "@/lib/gemini/recap";

export const POST = withRoom(async (_req, room) => json({ recap: await generateRecap(store, room.code) }));
