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

describe("team defaults", () => {
  it("loads a file saved before teams existed", () => {
    const p = party("Ops");
    const ws = workspace([p], [linearProcess(p.id)]);
    const legacy = JSON.parse(JSON.stringify(ws)) as Record<string, unknown>;
    delete legacy.teams;
    const view = legacy.view as Record<string, unknown>;
    delete view.highlightTeamId;
    delete view.teamFocus;
    for (const proc of legacy.processes as Array<{ steps: Array<Record<string, unknown>> }>) {
      for (const s of proc.steps) delete s.teamIds;
    }
    const out = migrate(legacy);
    expect(out.teams).toEqual([]);
    expect(out.view.highlightTeamId).toBeNull();
    expect(out.view.teamFocus).toBe("highlight");
    expect(out.processes[0].steps.every((s) => s.teamIds.length === 0)).toBe(true);
  });

  it("keeps teams and scopes through a round trip", () => {
    const p = party("Ops");
    const proc = linearProcess(p.id);
    proc.steps[1].teamIds = ["t1"];
    proc.steps[1].next[0].teamIds = ["t1"];
    const ws = { ...workspace([p], [proc]), teams: [{ id: "t1", name: "North", colourIndex: 0 }] };
    const exported = JSON.stringify(ws, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(exported)), null, 2)).toBe(exported);
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
