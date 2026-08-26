/** Deterministic 0..1 from case id — sandbox gateways must be replayable. */
export function sandboxUnit(id: string, salt = ""): number {
  let h = 2166136261;
  const s = id + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}
