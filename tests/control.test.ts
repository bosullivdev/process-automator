import { describe, expect, it } from "vitest";
import { processToCsv } from "../src/export/csv";
import { sizeStep } from "../src/graph/build-graph";
import { migrate } from "../src/model/schema";
import { party, process, step, workspace } from "./fixtures";

describe("controls on a step", () => {
  const ops = party("Ops", 0);
  const plain = step({ id: "a", displayNo: 1, name: "Reconcile", ownerId: ops.id });
  const ticked = { ...plain, hasControl: true };
  const referenced = { ...plain, hasControl: true, controlRef: " FIN-012 " };

  it("reserves a marker row under the step, in minimal mode too, and shows the reference", () => {
    const base = sizeStep(plain, "horizontal");
    const withControl = sizeStep(ticked, "horizontal");
    expect(base.text.control).toBeUndefined();
    expect(withControl.text.control).toBe("Control");
    expect(withControl.height).toBeGreaterThan(base.height);
    expect(withControl.shapeHeight).toBe(base.shapeHeight);
    const withRef = sizeStep(referenced, "horizontal", false, "minimal");
    expect(withRef.text.control).toBe("Control · FIN-012");
    expect(withRef.text.controlWidth).toBeGreaterThan(withControl.text.controlWidth);
    expect(withRef.height).toBe(withControl.height);
  });

  it("ignores a reference left on a step that is not ticked", () => {
    const stale = { ...plain, hasControl: false, controlRef: "FIN-012" };
    expect(sizeStep(stale, "horizontal").text.control).toBeUndefined();
    const csv = processToCsv(process([stale]), [ops]);
    expect(csv.split("\r\n")[1]).toBe("1,Reconcile,Ops,task,,,,,,,");
  });

  it("exports the tick and the reference as the last two CSV columns", () => {
    const lines = processToCsv(process([ticked, { ...referenced, id: "b", displayNo: 2 }]), [
      ops,
    ]).split("\r\n");
    expect(lines[0].endsWith(",Notes,Control,Control ref")).toBe(true);
    expect(lines[1]).toBe("1,Reconcile,Ops,task,,,,,,Yes,");
    expect(lines[2]).toBe("2,Reconcile,Ops,task,,,,,,Yes,FIN-012");
  });

  it("survives export and import, and files without the fields still load", () => {
    const ws = workspace([ops], [process([referenced, { ...plain, id: "b", displayNo: 2 }])]);
    const back = migrate(JSON.parse(JSON.stringify(ws)));
    expect(back.processes[0].steps[0]).toMatchObject({ hasControl: true, controlRef: " FIN-012 " });
    expect(back.processes[0].steps[1].hasControl).toBeUndefined();
  });
});
