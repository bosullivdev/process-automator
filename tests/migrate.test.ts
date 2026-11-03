import { describe, expect, it } from "vitest";
import { migrate, MigrationError } from "../src/model/schema";
import { linearProcess, party, workspace } from "./fixtures";

describe("migrate", () => {
  it("accepts a valid v1 workspace", () => {
    const p = party("Ops", 0, { colourOverride: "#aabbcc" });
    const ws = workspace([p], [linearProcess(p.id)]);
    const out = migrate(JSON.parse(JSON.stringify(ws)));
    expect(out).toEqual(ws);
  });

  it("round-trips export -> import unchanged", () => {
    const p = party("Ops");
    const ws = workspace([p], [linearProcess(p.id)]);
    const exported = JSON.stringify(ws, null, 2);
    const imported = migrate(JSON.parse(exported));
    expect(JSON.stringify(imported, null, 2)).toBe(exported);
  });

  it("rejects non-objects with a readable error", () => {
    expect(() => migrate(null)).toThrow(MigrationError);
    expect(() => migrate("x")).toThrow(/JSON object/);
    expect(() => migrate([])).toThrow(/JSON object/);
  });

  it("rejects missing or unsupported schemaVersion", () => {
    expect(() => migrate({})).toThrow(/schemaVersion/);
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/Unsupported schemaVersion 99/);
  });

  it("rejects malformed content and names the path", () => {
    const ws = workspace([], []);
    const bad = { ...ws, view: { ...ws.view, splitRatio: 5 } };
    expect(() => migrate(bad)).toThrow(/view\.splitRatio/);
    const badStep = {
      ...ws,
      processes: [{ id: "p", name: "P", laneOrder: [], steps: [{ id: "s" }] }],
    };
    expect(() => migrate(badStep)).toThrow(/processes\.0\.steps\.0/);
  });

  it("rejects invalid colour overrides", () => {
    const ws = workspace([party("A", 0, { colourOverride: "red" })], []);
    expect(() => migrate(ws)).toThrow(/colourOverride/);
  });
});

describe("annotations default", () => {
  it("loads a file saved before the annotations setting existed", () => {
    const ws = workspace([], []);
    const { annotations: _dropped, ...legacyView } = ws.view;
    void _dropped;
    const out = migrate({ ...ws, view: legacyView });
    expect(out.view.annotations).toBe("full");
  });
});
