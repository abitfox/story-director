/**
 * YAML (de)serialization + lint for story documents.
 *
 * "The graph is data, editors are pluggable" — admin forms, visual editors
 * and AI generation pipelines all read/write the same StoryDoc. YAML import/
 * export lets an AI pipeline generate offline → humans review the diff →
 * import to ship.
 *
 * Import path: "story-director/yaml" (optional js-yaml peer).
 */

import { dump, load } from "js-yaml";
import type { StoryNodePayload, StoryNodeType } from "../core/director";

/* ============ Document shape (identical to a seed JSON) ============ */

export interface StoryDocNode {
  id: string;
  chapter: number;
  type: StoryNodeType;
  auto?: boolean;
  skippable?: boolean;
  silent?: boolean;
  payload: StoryNodePayload;
}

export interface StoryDoc {
  season: string;
  version: {
    v_no: number;
    name: string;
    entry: string;
    created_by?: string;
    note?: string;
  };
  variables?: { key: string; type?: string; desc?: string }[];
  nodes: StoryDocNode[];
}

/* ============ Linter: the gatekeeper before release ============ */

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export function lintStoryDoc(doc: StoryDoc): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!doc.season) errors.push("missing season");
  if (!doc.version?.entry) errors.push("missing version.entry (entry node)");
  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) {
    errors.push("nodes is empty — a story with no nodes cannot ship");
    return { errors, warnings };
  }

  const ids = new Set<string>();
  for (const n of doc.nodes) {
    if (!n.id) errors.push("node without id");
    else if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    else ids.add(n.id);
  }

  if (doc.version?.entry && !ids.has(doc.version.entry)) {
    errors.push(`entry node does not exist: ${doc.version.entry}`);
  }

  const hasTask = doc.nodes.some((n) => n.type === "task");
  if (!hasTask) errors.push("no task nodes — the story cannot progress");

  // Edge references + task requirements
  for (const n of doc.nodes) {
    const edges: Array<[string, string | null | undefined]> = [
      ["next", n.payload?.next],
      ["remediate", n.payload?.remediate],
    ];
    for (const [name, to] of edges) {
      if (to && !ids.has(to)) errors.push(`${n.id}.${name} dangling reference: ${to}`);
    }
    if (n.type === "task") {
      if (!n.payload?.action) errors.push(`task node ${n.id} missing payload.action`);
      if ((n.payload?.action === "decode" || n.payload?.action === "challenge") && !n.payload?.chapter) {
        errors.push(`task node ${n.id} missing payload.chapter`);
      }
      const lines = n.payload?.lines ?? [];
      if (lines.length === 0) warnings.push(`task node ${n.id} has no narrative lines`);
      for (const [i, l] of lines.entries()) {
        if (!l.zh || !l.en) errors.push(`task node ${n.id} lines[${i}] missing zh or en (bilingual discipline)`);
      }
    }
    if (n.type === "gate" && !n.payload?.sku) {
      warnings.push(`gate node ${n.id} has no sku; defaults to any_pass`);
    }
  }

  // Reachability: traverse next/remediate from the entry
  const entry = doc.version?.entry;
  if (entry && ids.has(entry)) {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length) {
      const cur = queue.shift() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = doc.nodes.find((x) => x.id === cur);
      if (!n) continue;
      if (n.payload?.next) queue.push(n.payload.next);
      if (n.payload?.remediate) queue.push(n.payload.remediate);
    }
    for (const n of doc.nodes) {
      if (!seen.has(n.id)) warnings.push(`node ${n.id} is unreachable from the entry (orphan)`);
    }
  }

  return { errors, warnings };
}

/* ============ YAML serialize / parse ============ */

export function storyDocToYaml(doc: StoryDoc): string {
  return dump(doc, {
    lineWidth: 120,
    noRefs: true,
  });
}

/** Parse YAML/JSON text into a StoryDoc; throws a reason-bearing error on bad shape. */
export function storyDocFromYaml(text: string): StoryDoc {
  let data: unknown;
  try {
    const trimmed = text.trim();
    data = trimmed.startsWith("{") ? JSON.parse(trimmed) : load(trimmed);
  } catch (e) {
    throw new Error(`parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const doc = data as StoryDoc;
  if (!doc || typeof doc !== "object") throw new Error("parsed result is not an object");
  if (!Array.isArray(doc.nodes)) throw new Error("missing nodes array");
  if (!doc.version || typeof doc.version !== "object") throw new Error("missing version section");
  return doc;
}
