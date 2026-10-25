<div align="center">

# story-director

**Node-graph story director engine — a bypass layer that consults your command flow against a story graph and never imprisons the user. YAML is the single contract: AI pipelines generate, humans review, lint guards the release.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/abitfox/story-director/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)

[中文文档](./README.zh-CN.md)

</div>

---

> ▶ **Live site: [www.hackerenglish.com](https://www.hackerenglish.com)** — the storyline in its terminal is directed by this engine.

Most narrative engines take over your app: the player lives inside the story.
StoryDirector inverts that — it sits **beside** your existing commands. When a
user acts, ask the director; if the action matches the current story node, you
get narrative lines and an optional target. Otherwise you get `null` and run
your normal free behavior.
<div align="center">
  <img src="docs/media/demo.png" alt="story-director example graph" width="820" />
</div>
 Story nodes route players, gates check passes, but
**nobody is ever trapped**: any command that isn't this node's business just
works as usual.

```ts
import { consult, walk, onUnitDone } from "story-director";

// User typed a command — ask the director first
const directive = consult(graph, progress, "/decode", holdsPass);
if (directive) {
  pushLines(directive.lines);           // narrative
  if (directive.target) startTask(directive.target);
} else {
  runFreeCommand(cmd);                  // director not interested
}
```

## Design principles

- **The director never imprisons the user** — consultation is advisory; a
  non-matching command always falls through to free behavior.
- **Version-stable node ids** — progress is stored by id (`s1.ch1.u1`), so
  shipping a new story version never strands player progress.
- **The graph is data, editors are pluggable** — admin forms, visual editors
  and AI pipelines all read/write the same `StoryDoc`; YAML import/export
  enables the *generate offline → review diff → lint → ship* workflow.
- **Pure logic** — consult/walk/transition functions are side-effect-free;
  persistence and delivery stay in your app (DB adapter is your seam).

## Node vocabulary (fixed in code)

| Type | Behavior |
| --- | --- |
| `briefing` | exposition, auto-advanced by `walk()` |
| `task` | stops the walk — player must perform `payload.action` (`decode` / `challenge` / `drill`) |
| `hook` | cliffhanger beat, auto-advanced |
| `gate` | stops the walk unless the player holds `payload.sku` |
| `reward` | grant beat, auto-advanced |
| `checkpoint` | save beat, auto-advanced |

Transitions: `onUnitDone` (pass → `next`; fail → `remediate`, remembering the
return point in `vars.return_to`), `onChallengeDone`, `onDrillDone` (passing
returns to the remediation source), `onUnitQuit` (reaction lines only).

## Install

```bash
npm install story-director
npm install js-yaml   # optional peer, only for the YAML entry
```

| Part | Import |
| --- | --- |
| Director core (zero deps) | `"story-director"` |
| YAML + linter | `"story-director/yaml"` |

## YAML workflow

```bash
npm run lint -- docs/example/story.yaml   # lint your doc before shipping
```

```ts
import { storyDocFromYaml, lintStoryDoc, storyDocToYaml } from "story-director/yaml";
import { graphFromSeed } from "story-director";

const doc = storyDocFromYaml(yamlText);
const { errors, warnings } = lintStoryDoc(doc); // dangling edges, orphans, bilingual discipline, ...
if (errors.length === 0) {
  const graph = graphFromSeed({ season: doc.season, version: doc.version, nodes: doc.nodes });
}
```

A complete example story lives at
[`docs/example/story.yaml`](./docs/example/story.yaml) — briefing → decode
task → drill remediation → chapter challenge.

## Lint checks

- required structure (`season`, `version.entry`, non-empty `nodes`)
- duplicate ids, dangling `next`/`remediate` edges
- task nodes must declare `action` (+ `chapter` for decode/challenge)
- bilingual discipline: every task line needs both `zh` and `en`
- reachability from the entry (orphan nodes are warnings)
- gate nodes without `sku` default to `any_pass`

## Origin

Extracted from the HackerEnglish project, where it directs a spy-thriller
story across an English-learning terminal. The design notes (three rounds of
discussion) live in the original repo's docs. See
[`docs/PORTING.md`](./docs/PORTING.md).

## License

[MIT](./LICENSE).
