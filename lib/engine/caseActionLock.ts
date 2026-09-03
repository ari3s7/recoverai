const inflight = new Map<string, Promise<unknown>>();

function createActionKey(caseId: string, actionType: string): string {
  return `${caseId}:${actionType}`;
}

function isCreateAction(actionType: string): boolean {
  return actionType === "run" || actionType === "live_ai";
}

/**
 * Coalesce concurrent payment-link creates for the same case/action.
 * Rapid double-clicks share one in-flight promise instead of issuing two links.
 */
export function withCaseCreateLock<T>(
  caseId: string,
  actionType: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isCreateAction(actionType)) return fn();
  const key = createActionKey(caseId, actionType);
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const run = fn().finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

export function startExclusiveAction(flag: { current: boolean }): boolean {
  if (flag.current) return false;
  flag.current = true;
  return true;
}

export function resetCaseCreateLocks(): void {
  inflight.clear();
}
