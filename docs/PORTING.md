# PORTING.md — 20_HackerEnglish → story-director

| 原位置 | 新位置 | 改动 |
|---|---|---|
| `frontend/src/lib/director.ts`（类型 + 纯逻辑 + fallback 剧本） | `src/core/director.ts` | 业务权益枚举（Sku: S1_PASS 等）泛化为 opaque string；`graphFromSeed` 不再内置种子（种子改为调用方传入）；Fallback 概念保留在调用侧——DB 不可用时回退内置快照是宿主策略；`target` 的 chapterIdx 口径与注释一并移植；台词双语结构（zh/en）作为内置约定保留 |
| `frontend/src/lib/story-yaml.ts` | `src/yaml/story-yaml.ts`（独立入口 `"story-director/yaml"`） | js-yaml 改为可选 peer；校验器错误文案中文化→英文；lint 检查项原样保留（悬空边/重复 id/双语纪律/可达性） |
| `frontend/src/lib/story-seed-s1.json`（S1 剧本种子） | `docs/example/story.yaml` | 业务台词替换为通用科幻小剧本（观测站/信号解析），节点结构与原版一致 |
| `frontend/src/lib/story-db.ts`（Supabase 读取层） | 未搬运 | 持久化本就是宿主接缝——`StoryGraph`/`StoryProgress` 是纯数据，DB/存储由使用方实现 |

关键设计保留（均出自原项目设计文档的三轮讨论）：

- 导演是旁路接管层：consult 不命中即返回 null，永不监禁用户
- 节点 ID 跨版本稳定（s1.ch1.u1），切版本不丢进度
- 失败补救：`vars.return_to` 记返回点；补救节点引导台词随失败即时推送（否则失败后只有结算数据没有剧情推进）
- challenge 的 remediate 指回自己 = 原地重试
- 「词表固定在代码里，内容活在数据里」：六类节点类型封闭枚举，扩类型才改代码
