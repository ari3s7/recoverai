import { processCase } from "../lib/engine/process";
import { isBatchEligible } from "../lib/engine/runBatch";
import { computeTotals } from "../lib/engine/totals";
import { emptyWorkspace } from "../lib/db/store";
import { policyNow } from "../lib/policy/defaults";

const ws = emptyWorkspace();
const now = policyNow(ws.policy);
const next = ws.cases.map((c) =>
  isBatchEligible(c) ? processCase({ ...c, status: "in_flight" }, ws.policy, now) : c,
);
const t = computeTotals(next);
const counts = next.reduce<Record<string, number>>((acc, c) => {
  acc[c.status] = (acc[c.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ totals: t, counts }, null, 2));
const demo = ["NV-1048", "NV-1054", "NV-1057", "NV-1079", "NV-1083"].map((id) => {
  const c = next.find((x) => x.id === id);
  return c
    ? { id, status: c.status, play: c.play?.id, cause: c.diagnosis?.rootCause, policy: c.policy?.ruleId }
    : { id, missing: true };
});
console.log(JSON.stringify(demo, null, 2));
