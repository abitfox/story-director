/**
 * StoryDirector core — a node-graph story director engine.
 *
 * The story is a graph of nodes living in your own storage (DB, JSON, ...).
 * The director is a *bypass layer*: when the user performs an action, ask the
 * director first (consult); if the action matches the current story node, it
 * returns narrative lines and an optional target — otherwise it returns null
 * and your app does its normal free behavior. **The director never imprisons
 * the user.**
 *
 * Node ids are stable across story versions (e.g. "s1.ch1.u1"); player
 * progress is stored by id, so switching versions never loses progress.
 *
 * Ported from the HackerEnglish project's lib/director.ts (MIT), with the
 * business entitlement model generalized to opaque string SKUs.
 */

/* ============ Vocabulary (fixed in code; content lives in data) ============ */

/** Node types are a closed vocabulary — the engine knows how to treat each. */
export type StoryNodeType =
  | "briefing" // exposition, auto-advanced
  | "task" // stops the walk: the player must perform the payload action
  | "hook" // narrative cliffhanger, auto-advanced
  | "gate" // stops the walk unless the player holds the payload sku
  | "reward" // grant/reward beat, auto-advanced
  | "checkpoint"; // save beat, auto-advanced

export type StoryAction = "decode" | "challenge" | "drill";

/** Opaque entitlement id — map it to your own passes/subscriptions. */
export type StorySku = string;

export interface StoryLine {
  /** Primary language line */
  zh: string;
  /** Secondary language line (the engine treats lines as opaque pairs) */
  en: string;
}

export interface StoryNodePayload {
  /** Narrative lines delivered when the node is passed/consulted */
  lines?: StoryLine[];
  /** Lines on task success */
  doneLines?: StoryLine[];
  /** Lines on task failure */
  failLines?: StoryLine[];
  /** Lines when the player quits mid-task */
  quitLines?: StoryLine[];
  /** Lines on drill retry */
  retryLines?: StoryLine[];
  /** Outgoing edge (next node id, or "" / undefined = graph end) */
  next?: string | null;
  /** Remediation edge on task failure (e.g. a drill node) */
  remediate?: string | null;
  // ---- task payloads ----
  action?: StoryAction;
  chapter?: number;
  unit?: number;
  /** drill pass score (default: DRILL_DEFAULT_PASS) */
  passScore?: number;
  // ---- gate payloads ----
  sku?: StorySku;
}

export interface StoryNode {
  id: string;
  chapter: number;
  type: StoryNodeType;
  /** Auto-fired on entering the station */
  auto: boolean;
  skippable: boolean;
  /** Even in free mode, don't push this node's lines */
  silent: boolean;
  payload: StoryNodePayload;
}

export interface StoryGraph {
  seasonId: string;
  versionId: string;
  vNo: number;
  name: string;
  entry: string;
  nodes: Record<string, StoryNode>;
}

export interface StoryProgress {
  /** "" = outside the graph (free roam) */
  currentNode: string;
  /** Scratch space for the host app; `return_to` is reserved by the director */
  vars: Record<string, unknown>;
  nodeDone: string[];
}

/** The director's answer to a consult: intercept=true means take over this command (push lines, don't execute). */
export interface StoryDirective {
  intercept: boolean;
  lines: StoryLine[];
  /** On decode/challenge hits: target the host should apply before executing */
  target?: { chapterIdx: number; unitCursor?: number };
}

export const STORY_PASS_THRESHOLD = 50;
export const DRILL_DEFAULT_PASS = 60;

/* ============ Graph construction ============ */

/** Seed document shape — the same shape the YAML entry (de)serializes. */
export interface SeedDoc {
  season: string;
  version: { v_no: number; name: string; entry: string };
  nodes: Array<{
    id: string;
    chapter?: number;
    type: string;
    auto?: boolean;
    skippable?: boolean;
    silent?: boolean;
    payload?: StoryNodePayload;
  }>;
}

/** Build a StoryGraph from a seed document (versionId = "fallback" by convention). */
export function graphFromSeed(doc: SeedDoc): StoryGraph {
  const nodes: Record<string, StoryNode> = {};
  for (const n of doc.nodes) {
    nodes[n.id] = {
      id: n.id,
      chapter: n.chapter ?? 0,
      type: n.type as StoryNodeType,
      auto: !!n.auto,
      skippable: !!n.skippable,
      silent: !!n.silent,
      payload: n.payload ?? {},
    };
  }
  return {
    seasonId: doc.season,
    versionId: "fallback",
    vNo: doc.version.v_no,
    name: doc.version.name,
    entry: doc.version.entry,
    nodes,
  };
}

/* ============ Pure logic: consult / advance (side effects live in the host) ============ */

export type StoryCmd = "/decode" | "/challenge" | "/drill";

export function cmdToAction(cmd: StoryCmd): StoryAction {
  return cmd === "/decode" ? "decode" : cmd === "/challenge" ? "challenge" : "drill";
}

/**
 * Walk the graph from `progress.currentNode`, passing through non-task nodes
 * (briefing/hook/reward/checkpoint), stopping at a task, at a gate the player
 * can't open, or at the graph end. Returns the traversed nodes (the host
 * delivers their lines / records completion) and the stop node.
 */
export function walk(
  graph: StoryGraph,
  progress: StoryProgress,
  opts: { holdsPass: (sku: StorySku) => boolean; maxSteps?: number },
): { passed: StoryNode[]; stop: string } {
  const passed: StoryNode[] = [];
  let cur = progress.currentNode;
  let steps = opts.maxSteps ?? 16;
  while (steps-- > 0) {
    if (!cur) return { passed, stop: "" }; // graph end
    const node = graph.nodes[cur];
    if (!node) return { passed, stop: "" }; // dangling edge counts as the end (lint reports it)
    if (node.type === "task") return { passed, stop: cur };
    if (node.type === "gate" && !opts.holdsPass(node.payload.sku ?? "any_pass")) {
      return { passed, stop: cur }; // wait at the gate
    }
    passed.push(node);
    cur = node.payload.next ?? "";
  }
  return { passed, stop: cur };
}

/**
 * Consult: the player issued a command at the current node. Returns the
 * director's reply, or null when not applicable (free behavior proceeds).
 */
export function consult(
  graph: StoryGraph,
  progress: StoryProgress,
  cmd: StoryCmd,
  holdsPass: (sku: StorySku) => boolean,
): StoryDirective | null {
  const cur = progress.currentNode;
  if (!cur) return null;
  const node = graph.nodes[cur];
  if (!node) return null;

  // Gate: /drill always passes (free); decode/challenge check entitlements,
  // and an unheld pass means a narrative intercept.
  if (node.type === "gate") {
    if (cmd === "/drill") return null;
    if (holdsPass(node.payload.sku ?? "any_pass")) return null; // caller walks the gate first, then re-consults
    return { intercept: true, lines: node.payload.lines ?? [] };
  }
  if (node.type !== "task") return null;

  const want = node.payload.action;
  const act = cmdToAction(cmd);
  if (!want || want !== act) return null; // not this node's task → free behavior (the director never imprisons)

  const directive: StoryDirective = { intercept: false, lines: node.payload.lines ?? [] };
  if (act === "decode") {
    directive.target = {
      chapterIdx: Math.max(0, (node.payload.chapter ?? 1) - 1),
      unitCursor: node.payload.unit ?? 0,
    };
  } else if (act === "challenge") {
    directive.target = { chapterIdx: Math.max(0, (node.payload.chapter ?? 1) - 1) };
  }
  return directive;
}

/**
 * Unit-completion report → progress transition. Returns null when the report
 * doesn't match the current node (ignore and carry on).
 */
export function onUnitDone(
  graph: StoryGraph,
  progress: StoryProgress,
  r: { chapter: number; unit: number; accuracy: number },
): { progress: StoryProgress; lines: StoryLine[] } | null {
  const node = graph.nodes[progress.currentNode];
  if (!node || node.type !== "task") return null;
  const p = node.payload;
  if (p.action !== "decode" || p.chapter !== r.chapter || p.unit !== r.unit) return null;

  const lines: StoryLine[] = [];
  const vars = { ...progress.vars };
  const nodeDone = progress.nodeDone.includes(node.id)
    ? progress.nodeDone
    : [...progress.nodeDone, node.id];

  if (r.accuracy >= STORY_PASS_THRESHOLD) {
    lines.push(...(p.doneLines ?? []));
    const next = p.next ?? "";
    return { progress: { currentNode: next, vars, nodeDone }, lines };
  }
  // Failure → remediation edge: remember where to return, head to the drill.
  lines.push(...(p.failLines ?? []));
  if (p.remediate) {
    vars.return_to = node.id;
    // Push the remediation node's intro lines immediately: walk() stops at
    // task nodes without delivering lines, and without this the terminal
    // would only show score data with no narrative progression.
    const rem = graph.nodes[p.remediate];
    if (rem && !rem.silent) lines.push(...(rem.payload.lines ?? []));
    return { progress: { currentNode: p.remediate, vars, nodeDone }, lines };
  }
  return { progress: { ...progress, nodeDone }, lines }; // no remediation edge: retry in place
}

/** Challenge-completion report → progress transition. */
export function onChallengeDone(
  graph: StoryGraph,
  progress: StoryProgress,
  r: { chapter: number; passed: boolean },
): { progress: StoryProgress; lines: StoryLine[] } | null {
  const node = graph.nodes[progress.currentNode];
  if (!node || node.type !== "task") return null;
  const p = node.payload;
  if (p.action !== "challenge" || p.chapter !== r.chapter) return null;

  const nodeDone = progress.nodeDone.includes(node.id)
    ? progress.nodeDone
    : [...progress.nodeDone, node.id];
  if (r.passed) {
    return {
      progress: { currentNode: p.next ?? "", vars: { ...progress.vars }, nodeDone },
      lines: p.doneLines ?? [],
    };
  }
  // Failure: a self-referencing remediate means retry in place; otherwise take
  // the remediation edge (its intro lines are pushed immediately, as above).
  const target = p.remediate && p.remediate !== node.id ? p.remediate : progress.currentNode;
  const failLines = [...(p.failLines ?? [])];
  if (target !== progress.currentNode) {
    const rem = graph.nodes[target];
    if (rem && !rem.silent) failLines.push(...(rem.payload.lines ?? []));
  }
  return {
    progress: { currentNode: target, vars: { ...progress.vars }, nodeDone },
    lines: failLines,
  };
}

/** Mid-task quit report → narrative reaction only (no progress change). */
export function onUnitQuit(
  graph: StoryGraph,
  progress: StoryProgress,
  r: { chapter: number; unit: number; challenge?: boolean },
): StoryLine[] | null {
  const node = graph.nodes[progress.currentNode];
  if (!node || node.type !== "task") return null;
  const p = node.payload;
  const matched = r.challenge
    ? p.action === "challenge" && p.chapter === r.chapter
    : p.action === "decode" && p.chapter === r.chapter && p.unit === r.unit;
  if (!matched || !p.quitLines?.length) return null;
  return p.quitLines;
}

/** Drill-completion report → progress transition (passing returns to the remediation source). */
export function onDrillDone(
  graph: StoryGraph,
  progress: StoryProgress,
  accuracy: number,
): { progress: StoryProgress; lines: StoryLine[] } | null {
  const node = graph.nodes[progress.currentNode];
  if (!node || node.type !== "task" || node.payload.action !== "drill") return null;
  const p = node.payload;
  const nodeDone = progress.nodeDone.includes(node.id)
    ? progress.nodeDone
    : [...progress.nodeDone, node.id];
  if (accuracy >= (p.passScore ?? DRILL_DEFAULT_PASS)) {
    const back = String(progress.vars.return_to ?? "") || p.next || "";
    const vars = { ...progress.vars };
    delete vars.return_to;
    return { progress: { currentNode: back, vars, nodeDone }, lines: p.doneLines ?? [] };
  }
  return { progress: { ...progress, nodeDone }, lines: p.retryLines ?? [] };
}
