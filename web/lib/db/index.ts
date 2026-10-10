import { MemoryStore } from "./memory";
import type { Store } from "./store";

// Survives Next.js dev HMR / separate route bundles by living on globalThis.
const g = globalThis as unknown as { __bdjStore?: Store };
export const store: Store = (g.__bdjStore ??= new MemoryStore());
