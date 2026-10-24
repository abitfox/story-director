import { describe, expect, it } from "vitest";
import {
  graphFromSeed,
  consult,
  walk,
  onUnitDone,
  onDrillDone,
  onChallengeDone,
  type SeedDoc,
  type StoryGraph,
  type StoryProgress,
} from "../src/core/director";

const seed: SeedDoc = {
  season: "s1",
  version: { v_no: 1, name: "test", entry: "brief" },
  nodes: [
    { id: "brief", chapter: 1, type: "briefing", auto: true, payload: { lines: [{ zh: "开场", en: "Opening" }], next: "task1" } },
    {
      id: "task1",
      chapter: 1,
      type: "task",
      payload: {
        action: "decode",
        chapter: 1,
        unit: 1,
        lines: [{ zh: "解析信号", en: "Decode it" }],
        doneLines: [{ zh: "完成", en: "Done" }],
        failLines: [{ zh: "失败", en: "Failed" }],
        remediate: "drill1",
        next: "task2",
      },
    },
    {
      id: "drill1",
      chapter: 1,
      type: "task",
      payload: { action: "drill", passScore: 60, lines: [{ zh: "训练", en: "Drill" }], doneLines: [{ zh: "通过", en: "Pass" }] },
    },
    {
      id: "task2",
      chapter: 1,
      type: "task",
      payload: { action: "challenge", chapter: 1, lines: [{ zh: "挑战", en: "Challenge" }], next: "" },
    },
  ],
};

function setup() {
  const graph: StoryGraph = graphFromSeed(seed);
  // Start one step before task1: brief auto-advances into it
  const progress: StoryProgress = { currentNode: "brief", vars: {}, nodeDone: [] };
  const step = walk(graph, progress, { holdsPass: () => false });
  return { graph, progress: { ...progress, currentNode: step.stop } };
}

describe("walk", () => {
  it("passes auto nodes and stops at a task", () => {
    const { graph, progress } = setup();
    expect(progress.currentNode).toBe("task1");
    expect(walk(graph, progress, { holdsPass: () => false }).stop).toBe("task1");
  });

  it("stops at a gate the player cannot open", () => {
    const graph = graphFromSeed({
      season: "s",
      version: { v_no: 1, name: "g", entry: "gate" },
      nodes: [
        { id: "gate", type: "gate", payload: { sku: "vip", next: "t" } },
        { id: "t", type: "task", payload: { action: "drill" } },
      ],
    });
    const r = walk(graph, { currentNode: "gate", vars: {}, nodeDone: [] }, { holdsPass: () => false });
    expect(r.stop).toBe("gate");
    const r2 = walk(graph, { currentNode: "gate", vars: {}, nodeDone: [] }, { holdsPass: () => true });
    expect(r2.stop).toBe("t");
  });
});

describe("consult", () => {
  it("delivers lines and a target for the matching action", () => {
    const { graph, progress } = setup();
    const d = consult(graph, progress, "/decode", () => false);
    expect(d?.intercept).toBe(false);
    expect(d?.lines[0].en).toBe("Decode it");
    expect(d?.target).toEqual({ chapterIdx: 0, unitCursor: 1 });
  });

  it("never imprisons: non-matching commands return null", () => {
    const { graph, progress } = setup();
    expect(consult(graph, progress, "/challenge", () => true)).toBeNull();
    expect(consult(graph, progress, "/drill", () => true)).toBeNull();
  });

  it("intercepts at gates without the pass", () => {
    const graph = graphFromSeed({
      season: "s",
      version: { v_no: 1, name: "g", entry: "gate" },
      nodes: [{ id: "gate", type: "gate", payload: { sku: "vip", lines: [{ zh: "拦", en: "Stop" }] } }],
    });
    const d = consult(graph, { currentNode: "gate", vars: {}, nodeDone: [] }, "/decode", () => false);
    expect(d?.intercept).toBe(true);
    // /drill always passes a gate
    expect(consult(graph, { currentNode: "gate", vars: {}, nodeDone: [] }, "/drill", () => false)).toBeNull();
  });
});

describe("progress transitions", () => {
  it("onUnitDone: pass advances along next", () => {
    const { graph, progress } = setup();
    const r = onUnitDone(graph, progress, { chapter: 1, unit: 1, accuracy: 90 });
    expect(r?.progress.currentNode).toBe("task2");
    expect(r?.progress.nodeDone).toContain("task1");
  });

  it("onUnitDone: fail routes to remediation and remembers return_to", () => {
    const { graph, progress } = setup();
    const r = onUnitDone(graph, progress, { chapter: 1, unit: 1, accuracy: 10 });
    expect(r?.progress.currentNode).toBe("drill1");
    expect(r?.progress.vars.return_to).toBe("task1");
    // remediation intro lines are pushed immediately
    expect(r?.lines.some((l) => l.en === "Drill")).toBe(true);
  });

  it("onDrillDone: passing returns to the remediation source", () => {
    const { graph, progress } = setup();
    const failed = onUnitDone(graph, progress, { chapter: 1, unit: 1, accuracy: 10 })!;
    const done = onDrillDone(graph, failed.progress, 80);
    expect(done?.progress.currentNode).toBe("task1");
    expect(done?.progress.vars.return_to).toBeUndefined();
  });

  it("onDrillDone: failing stays for a retry", () => {
    const { graph, progress } = setup();
    const failed = onUnitDone(graph, progress, { chapter: 1, unit: 1, accuracy: 10 })!;
    const done = onDrillDone(graph, failed.progress, 30);
    expect(done?.progress.currentNode).toBe("drill1");
  });

  it("onChallengeDone: pass ends the graph", () => {
    const { graph } = setup();
    const at2: StoryProgress = { currentNode: "task2", vars: {}, nodeDone: [] };
    const r = onChallengeDone(graph, at2, { chapter: 1, passed: true });
    expect(r?.progress.currentNode).toBe("");
  });

  it("ignores reports unrelated to the current node", () => {
    const { graph, progress } = setup();
    expect(onUnitDone(graph, progress, { chapter: 9, unit: 9, accuracy: 100 })).toBeNull();
  });
});
