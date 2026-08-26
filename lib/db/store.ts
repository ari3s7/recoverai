import { promises as fs } from "fs";
import path from "path";
import { computeTotals } from "../engine/totals";
import { uid } from "../ids";
import { DEFAULT_POLICY } from "../policy/defaults";
import { MERCHANT, SEED_CASES } from "../seed/cases";
import type { AuditEvent, PolicyConfig, RunCase, Workspace } from "../types";

const FILE = path.join(process.cwd(), "data", "store.json");

function asRunCase(seed: (typeof SEED_CASES)[number]): RunCase {
  return {
    ...seed,
    signals: { ...seed.signals, flags: [...seed.signals.flags] },
    status: "at_risk",
    timeline: [],
    updatedAt: seed.occurredAt,
  };
}

export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    merchant: { ...MERCHANT },
    policy: { ...DEFAULT_POLICY },
    cases: SEED_CASES.map(asRunCase),
    audit: [],
    runs: [],
  };
}

let chain: Promise<unknown> = Promise.resolve();

function lock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readFile(): Promise<Workspace> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Workspace;
    if (!parsed?.cases?.length) return emptyWorkspace();
    return parsed;
  } catch {
    return emptyWorkspace();
  }
}

async function writeFile(ws: Workspace): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ws, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

export async function getWorkspace(): Promise<Workspace> {
  return lock(readFile);
}

export async function mutateWorkspace(
  fn: (ws: Workspace) => Workspace | Promise<Workspace>,
): Promise<Workspace> {
  return lock(async () => {
    const current = await readFile();
    const next = await fn(current);
    await writeFile(next);
    return next;
  });
}

export async function resetWorkspace(): Promise<Workspace> {
  return mutateWorkspace(() => emptyWorkspace());
}

export function appendAudit(ws: Workspace, events: AuditEvent[]): Workspace {
  return { ...ws, audit: [...events, ...ws.audit].slice(0, 4000) };
}

export async function savePolicy(policy: PolicyConfig): Promise<Workspace> {
  return mutateWorkspace((ws) => ({
    ...ws,
    policy,
    audit: [
      {
        id: uid("evt"),
        ts: new Date().toISOString(),
        caseId: "SYSTEM",
        actor: "human",
        action: "policy.update",
        reason: "Operator updated stopping rules.",
      },
      ...ws.audit,
    ],
  }));
}

export function snapshotTotals(ws: Workspace) {
  return computeTotals(ws.cases);
}
