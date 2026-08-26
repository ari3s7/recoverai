export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nextCaseId(existing: string[]): string {
  const nums = existing
    .map((id) => Number(id.replace(/^NV-/, "")))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 1040;
  return `NV-${max + 1}`;
}
