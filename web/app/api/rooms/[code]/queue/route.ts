import { json, withRoom } from "@/lib/api";
import { store } from "@/lib/db";

export const GET = withRoom(async (_req, room) => json(await store.listQueue(room.code)));
