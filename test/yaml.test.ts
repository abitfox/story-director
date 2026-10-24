import { describe, expect, it } from "vitest";
import { lintStoryDoc, storyDocFromYaml, storyDocToYaml } from "../src/yaml/story-yaml";
import { readFileSync } from "node:fs";
import type { StoryDoc } from "../src/yaml/story-yaml";

const example = readFileSync(new URL("../docs/example/story.yaml", import.meta.url), "utf8");

describe("storyDocFromYaml", () => {
  it("parses the shipped example", () => {
    const doc = storyDocFromYaml(example);
    expect(doc.season).toBe("s1");
    expect(doc.nodes.length).toBe(4);
  });

  it("accepts JSON too", () => {
    const doc = storyDocFromYaml(JSON.stringify({ season: "x", version: { v_no: 1, name: "n", entry: "a" }, nodes: [] }));
    expect(doc.version.v_no).toBe(1);
  });

  it("throws reason-bearing errors on bad shapes", () => {
    expect(() => storyDocFromYaml("- just\n- a\n- list")).toThrow(/nodes/);
  });
});

describe("lintStoryDoc", () => {
  const base: StoryDoc = {
    season: "s1",
    version: { v_no: 1, name: "n", entry: "brief" },
    nodes: [],
  };

  it("flags an empty graph", () => {
    const r = lintStoryDoc(base);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("flags dangling edges and missing task fields", () => {
    const r = lintStoryDoc({
      season: "s1",
      version: { v_no: 1, name: "n", entry: "t1" },
      nodes: [
        { id: "t1", chapter: 1, type: "task", payload: { action: "decode", chapter: 1, next: "ghost" } },
      ],
    });
    expect(r.errors.some((e) => e.includes("dangling"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("no narrative lines"))).toBe(true);
  });

  it("enforces the bilingual discipline on task lines", () => {
    const r = lintStoryDoc({
      season: "s1",
      version: { v_no: 1, name: "n", entry: "t1" },
      nodes: [
        { id: "t1", chapter: 1, type: "task", payload: { action: "decode", chapter: 1, lines: [{ zh: "只有中文", en: "" }] } },
      ],
    });
    expect(r.errors.some((e) => e.includes("bilingual"))).toBe(true);
  });

  it("reports orphans via reachability", () => {
    const r = lintStoryDoc({
      season: "s1",
      version: { v_no: 1, name: "n", entry: "a" },
      nodes: [
        { id: "a", chapter: 1, type: "task", payload: { action: "drill" } },
        { id: "orphan", chapter: 1, type: "briefing", payload: {} },
      ],
    });
    expect(r.warnings.some((w) => w.includes("orphan") && w.includes("orphan"))).toBe(true);
  });
});

describe("yaml roundtrip", () => {
  it("survives toYaml → fromYaml", () => {
    const doc = storyDocFromYaml(example);
    const round = storyDocFromYaml(storyDocToYaml(doc));
    expect(round).toEqual(doc);
  });
});
