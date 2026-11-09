import { describe, expect, it } from "vitest";
import { readingOrder } from "../src/graph/reading-order";
import { csvField, processToCsv } from "../src/export/csv";
import { linearProcess, party, process, step } from "./fixtures";

describe("readingOrder", () => {
  it("walks from the start, one branch to its end before the next", () => {
    // start a -> b -> decision c -> { d (end), e -> f (end) }, rows stored out of order
    const p = linearProcess();
    p.steps.reverse();
    expect(readingOrder(p)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("handles cycles, joins and unreachable steps", () => {
    const p = process([
      step({ id: "x", displayNo: 9, next: [{ targetId: "b" }] }), // unreachable, listed last
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, next: [{ targetId: "c" }, { targetId: "d" }] }),
      step({ id: "c", displayNo: 3, next: [{ targetId: "b" }, { targetId: "e" }] }), // cycle back to b
      step({ id: "d", displayNo: 4, next: [{ targetId: "e" }] }), // joins at e
      step({ id: "e", displayNo: 5, type: "end" }),
    ]);
    expect(readingOrder(p)).toEqual(["a", "b", "c", "e", "d", "x"]);
  });

  it("falls back to display order with no start", () => {
    const p = process([
      step({ id: "q", displayNo: 2 }),
      step({ id: "p", displayNo: 1, next: [{ targetId: "q" }] }),
    ]);
    expect(readingOrder(p)).toEqual(["p", "q"]);
  });
});

describe("csv export", () => {
  it("quotes fields with commas, quotes and line breaks", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a, b")).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
  });

  it("writes names instead of ids, type variants and labelled next links", () => {
    const ops = party("Ops");
    const fin = party("Finance, EMEA");
    const p = process([
      step({
        id: "a",
        displayNo: 1,
        type: "start",
        startKind: "timer",
        ownerId: ops.id,
        name: "Begin",
        next: [{ targetId: "d" }],
      }),
      step({
        id: "d",
        displayNo: 2,
        type: "decision",
        ownerId: fin.id,
        name: "Approve?",
        technology: "SAP",
        contributorIds: [ops.id],
        notes: 'Check "limits"',
        next: [
          { targetId: "z", label: "Yes", isDefault: true },
          { targetId: "gone", label: "No" },
        ],
      }),
      step({
        id: "z",
        displayNo: 3,
        type: "end",
        endKind: "terminate",
        ownerId: null,
        name: "Done",
      }),
    ]);
    const csv = processToCsv(p, [ops, fin]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("No,Name,Owner,Type,Next,Technology,Contributors,Teams,Notes");
    expect(lines[1]).toBe("1,Begin,Ops,start · timer,2: Approve?,,,,");
    expect(lines[2]).toBe(
      '2,Approve?,"Finance, EMEA",decision,"3: Done [Yes, default]; missing step [No]",SAP,Ops,,"Check ""limits"""',
    );
    expect(lines[3]).toBe("3,Done,,end · terminate,,,,,");
  });
});
