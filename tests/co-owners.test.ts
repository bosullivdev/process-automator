import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { buildLayoutGraph, laneNodeId } from "../src/graph/build-graph";
import { layoutGraph } from "../src/graph/layout";
import { migrate } from "../src/model/schema";
import { isPartyReferenced, mergeParties } from "../src/model/party";
import { validateProcess } from "../src/model/validate";
import { party, process, step, workspace } from "./fixtures";

const elk = new ELK();

const sales = party("Sales", 0);
const legal = party("Legal", 1);
const parties = [sales, legal];

/** start(a, Sales) -> review(b, Sales + Legal) -> end(c, Sales) */
function shared() {
  return process(
    [
      step({ id: "a", displayNo: 1, type: "start", ownerId: sales.id, next: [{ targetId: "b" }] }),
      step({
        id: "b",
        displayNo: 2,
        name: "Review",
        ownerId: sales.id,
        coOwnerIds: [legal.id],
        next: [{ targetId: "c" }],
      }),
      step({ id: "c", displayNo: 3, type: "end", ownerId: sales.id }),
    ],
    { laneOrder: [sales.id, legal.id] },
  );
}

describe("co-owned steps in the layout graph", () => {
  it("draws the step once per lane with the same links in and out", () => {
    const g = buildLayoutGraph(shared(), parties, "simple");
    const copy = laneNodeId("b", legal.id);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b", copy, "c"]);
    expect(g.nodes.find((n) => n.id === copy)).toMatchObject({
      kind: "task",
      laneId: legal.id,
      stepId: "b",
    });
    expect(g.nodes.find((n) => n.id === "b")!.laneId).toBe(sales.id);
    expect(g.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(
      ["a->b", `a->${copy}`, "b->c", `${copy}->c`].sort(),
    );
    // Every arrow still belongs to the one step, for selection and team fading.
    expect(g.edges.every((e) => e.sourceStepId !== copy && e.targetStepId !== copy)).toBe(true);
    expect(g.laneOrder).toEqual([sales.id, legal.id]);
  });

  it("keeps each party's copies together when consecutive steps share the parties", () => {
    const p = shared();
    // review(b) -> check(d), both Sales + Legal, then d -> end(c)
    p.steps[1].next = [{ targetId: "d" }];
    p.steps.push(
      step({
        id: "d",
        displayNo: 4,
        type: "decision",
        ownerId: sales.id,
        coOwnerIds: [legal.id],
        next: [
          { targetId: "c", label: "Yes" },
          { targetId: "b", label: "No" },
        ],
      }),
    );
    const g = buildLayoutGraph(p, parties, "simple");
    const bL = laneNodeId("b", legal.id);
    const dL = laneNodeId("d", legal.id);
    const arrows = g.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(arrows).toEqual(
      [
        "a->b",
        `a->${bL}`,
        "b->d",
        `${bL}->${dL}`,
        "d->c",
        `${dL}->c`,
        "d->b",
        `${dL}->${bL}`,
      ].sort(),
    );
  });

  it("ignores co-owners that are the owner or unknown", () => {
    const p = shared();
    p.steps[1].coOwnerIds = [sales.id, "ghost", legal.id];
    const g = buildLayoutGraph(p, parties, "simple");
    expect(g.nodes.filter((n) => n.stepId === "b")).toHaveLength(2);
  });

  it("inserts a parallel fork before and a join after the copies in BPMN mode", () => {
    const g = buildLayoutGraph(shared(), parties, "bpmn");
    const copy = laneNodeId("b", legal.id);
    // The start is not a task, so no fork gateway; its two arrows fan out directly.
    expect(g.nodes.filter((n) => n.kind === "fork")).toHaveLength(0);
    expect(g.nodes.filter((n) => n.kind === "join").map((n) => n.id)).toEqual(["gw:join:c"]);
    expect(g.edges.some((e) => e.from === "b" && e.to === "gw:join:c")).toBe(true);
    expect(g.edges.some((e) => e.from === copy && e.to === "gw:join:c")).toBe(true);
  });

  it("forks a task that leads into a co-owned step", () => {
    const p = shared();
    p.steps[0].type = "task";
    const g = buildLayoutGraph(p, parties, "bpmn");
    expect(g.nodes.filter((n) => n.kind === "fork").map((n) => n.id)).toEqual(["gw:fork:a"]);
    expect(g.edges.filter((e) => e.from === "gw:fork:a")).toHaveLength(2);
  });

  it("joins at every copy when two steps lead into a co-owned step", () => {
    const p = shared();
    p.steps.push(
      step({ id: "d", displayNo: 4, type: "start", ownerId: legal.id, next: [{ targetId: "b" }] }),
    );
    const g = buildLayoutGraph(p, parties, "bpmn");
    const copy = laneNodeId("b", legal.id);
    expect(
      g.nodes
        .filter((n) => n.kind === "join")
        .map((n) => n.id)
        .sort(),
    ).toEqual(["gw:join:b", `gw:join:${copy}`, "gw:join:c"].sort());
  });

  it("lays out each copy inside its own lane", async () => {
    const g = buildLayoutGraph(shared(), parties, "simple");
    const r = await layoutGraph(g, "horizontal", elk);
    const laneOf = new Map(g.nodes.map((n) => [n.id, n.laneId]));
    for (const n of r.nodes) {
      const lane = r.lanes.find((l) => l.id === laneOf.get(n.id))!;
      expect(n.y).toBeGreaterThanOrEqual(lane.y);
      expect(n.y + n.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
    const b = r.nodes.find((n) => n.id === "b")!;
    const copy = r.nodes.find((n) => n.id === laneNodeId("b", legal.id))!;
    expect(copy.layer).toBe(b.layer);
    expect(copy.y).toBeGreaterThan(b.y);
  });
});

describe("co-owners elsewhere in the model", () => {
  it("flags an unknown co-owner", () => {
    const p = shared();
    p.steps[1].coOwnerIds = ["ghost"];
    const flags = validateProcess(p, { parties });
    expect(flags.filter((f) => f.code === "unknown-party")).toMatchObject([
      { stepId: "b", partyId: "ghost" },
    ]);
  });

  it("counts a co-owner as a reference that blocks deleting the party", () => {
    expect(isPartyReferenced(legal.id, [shared()])).toBe(true);
  });

  it("merges co-owners and drops one that becomes the owner", () => {
    const ws = workspace(parties, [shared()]);
    const merged = mergeParties(ws, sales.id, legal.id);
    expect(merged.processes[0].steps[1]).toMatchObject({ ownerId: sales.id, coOwnerIds: [] });
    const finance = party("Finance", 2);
    const ws2 = workspace([...parties, finance], [shared()]);
    const merged2 = mergeParties(ws2, finance.id, legal.id);
    expect(merged2.processes[0].steps[1].coOwnerIds).toEqual([finance.id]);
  });

  it("loads a file saved before co-owners existed", () => {
    const ws = workspace(parties, [shared()]);
    const json = JSON.parse(JSON.stringify(ws)) as { processes: Array<{ steps: object[] }> };
    for (const s of json.processes[0].steps) delete (s as { coOwnerIds?: string[] }).coOwnerIds;
    const out = migrate(json);
    expect(out.processes[0].steps.every((s) => s.coOwnerIds.length === 0)).toBe(true);
  });
});
