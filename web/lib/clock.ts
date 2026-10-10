/** Wall clock with an offset so scripts/tests can fast-forward through "minutes" of a night. */
let offsetMs = 0;
export const now = () => Date.now() + offsetMs;
export const advance = (ms: number) => {
  offsetMs += ms;
};
export const resetClock = () => {
  offsetMs = 0;
};
