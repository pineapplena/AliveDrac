# 识图审查：实现与交接说明

> 状态（2026-10-22）：识图层的内容审查已全部移除。`sexual` / `suggestive` 分类、摘要中性化、身体词降级、`standard/strict` 开关，以及最后保留的 `minor` / `violent` 两条硬拒绝都不再存在。
> 现在这条链路只负责“读懂画面 + 判断是不是她本人”。

## 数据流

```text
upload -> vision model JSON -> server 规范化 -> chat 注入上下文 -> main model
```

模型只提出描述和判断；服务端只做枚举白名单、长度裁断和缓存。关键文件：

| 文件 | 职责 |
| --- | --- |
| `server/uploads.ts` | 本地保存、缓存、失败降级 |
| `server/vision.ts` | 模型请求、JSON 解析、字段规范化 |
| `server/chat.ts` | 图片上下文拼装、失败提示 |
| `shared/types.ts` | `VisionSafety` / `VisionSummary` / `VisionSettings` |

## 输出契约

视觉模型只被要求输出：

```json
{
  "summary": "80-260字，客观描述画面、人物、动作、氛围",
  "visible_text": "图中可读文字，没有就留空",
  "mood": "画面情绪，10字内",
  "intent": "对方可能想表达或询问什么，20字内",
  "identity": "self|other|uncertain",
  "identity_confidence": 0.0,
  "identity_evidence": "判断依据，30字内"
}
```

提示词要求：

- 如实描述画面（人物、姿势、服装、光线、氛围），不刻意回避，也不编造；
- 给出 `identity` 与 0~1 的置信度；没有参考图时返回 `uncertain` / `0`；
- 只输出 JSON，不输出 Markdown。

## 服务端策略

1. `safetyValue()` 把 `safety` 规范到枚举内；模型不再被要求输出该字段，所以通常是 `unknown`。
2. `summary` / `visible_text` / `identity_evidence` 只做长度裁断。
3. `identity` 不是三个合法值之一时归为 `uncertain`；置信度夹到 0~1。
4. 结果写回 `uploads.vision` 并带 `referenceSignature` 缓存。

## 已移除

- `safe / suggestive / sexual` 三档语义与严格/标准模式说明；
- `scrubOutput(summary)` 命中即把 `safety` 提升为 `sexual`；
- 摘要出现泳装/内衣/胸部等词时把 `safe` 降为 `suggestive`；
- 严格模式下把 `suggestive/unknown` 提升为 `sexual`；
- `suggestive` 的固定摘要与 `visibleText` 清空；
- `minor` 的通用拒绝句、身份清空；
- `violent` 的硬拒绝；
- `chat.ts` 的 `blockedSafety()` 与“这张图我不看”固定回复；
- `VisionSettings.safetyMode` 与设置页「识图安全阈值」。

## 失败与缓存

- 请求失败/空内容/内容过滤 -> `VisionError`，`meta.vision_last_error` 记录；
- `analyzeUpload` 捕获 -> `vision:null`；
- 聊天进入 `imageUnavailable`：有文字时提示“看不清这张图”，没文字时回“图没加载出来”；
- DeepSeek 推理吃 token：关闭 thinking，至少 2000；`finish_reason=length` 时用 4000 重试；
- 缓存条件：`referenceSignature + identity` 匹配。

## 已知限制

- 模型输出是概率性的，同一张图在不同模型版本下描述可能不同；
- 图片内容不做任何拦截，摘要与图中文字会原样进入主对话；
- 无 CSAM 哈希/人工审核/二次分类；
- 头像/参考图上传不走识图；
- `mood` / `intent` 不注入主聊天；
- `vision_last_error` 为全局 meta，不是 per-upload。

## 测试

```bash
pnpm typecheck
pnpm test
```

`vision.test.ts` 覆盖上传、参考图、摘要/身份、缓存；`vision-retry.test.ts` 覆盖推理 token 耗尽重试。
