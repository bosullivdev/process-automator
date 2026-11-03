import type { Process } from "../model/types";

/**
 * Row order for reading the table top to bottom: a depth-first walk from each
 * start step (lowest display number first), following each step's next links
 * in their listed order, so a branch is read to its end before the next branch
 * begins. Steps the walk never reaches (orphans, dead cycles, and processes
 * with no start) follow in display-number order. Returns step ids.
 */
export function readingOrder(process: Process): string[] {
  const byId = new Map(process.steps.map((s) => [s.id, s]));
  const byNo = [...process.steps].sort((a, b) => a.displayNo - b.displayNo);
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const l of s.next) visit(l.targetId);
  };
  for (const s of byNo) if (s.type === "start") visit(s.id);
  for (const s of byNo) visit(s.id);
  return order;
}
