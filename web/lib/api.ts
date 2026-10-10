import { NextResponse } from "next/server";
import { store } from "./db";

export type Ctx = { params: Promise<{ code: string }> };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Wraps a route handler: resolves the room (404 if missing) and turns thrown errors into JSON 500s. */
export function withRoom(
  fn: (req: Request, room: NonNullable<Awaited<ReturnType<typeof store.getRoom>>>) => Promise<Response>,
) {
  return async (req: Request, { params }: Ctx) => {
    try {
      const { code } = await params;
      const room = await store.getRoom(code);
      if (!room) return fail("Room not found", 404);
      return await fn(req, room);
    } catch (e) {
      console.error(e);
      return fail(e instanceof Error ? e.message : "Internal error", 500);
    }
  };
}

export const readJson = async <T = Record<string, unknown>>(req: Request): Promise<T> => {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
};
