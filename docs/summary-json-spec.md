# JSOS 总结 JSON 规范 v1.0

## 1. 输出规则

最终回答只能包含一个带 `json` 语言标记的 Markdown 代码块，代码块内只能有一个合法 JSON 对象。代码块外不得添加标题、解释、注释或第二份总结，以便用户直接使用 ChatGPT 的“复制代码”按钮。

在 Live 内收到“请发总结”时，也以文字代码块生成，不朗读 JSON 正文；可以在语音中只提示“总结已生成”。即使项目来源暂时无法检索，也必须使用项目指令内嵌的 Schema 输出，不得拒绝、要求重新上传或改用另一套结构。

- 必须使用 ASCII 半角双引号 `"`、冒号 `:`、逗号 `,`、方括号和花括号。
- 禁止中文引号、中文冒号、尾随逗号和 JSON 之外的文字。
- 必须返回 `schemaVersion: "1.0"`、`rubricVersion: "1.0"` 和当天任务中的原始 `taskId`。
- 字段名、大小写、层级和类型不得改变。
- 未知单值使用 `null`；没有可靠内容的集合使用 `[]`。
- 输出前必须在内部确认标准 JSON 解析器能够解析，不展示检查过程。

## 2. 完整结构

```json
{
  "schemaVersion": "1.0",
  "rubricVersion": "1.0",
  "task": {
    "taskId": "task_xxx",
    "dayNumber": 3,
    "topic": "外食",
    "taskType": "core",
    "difficulty": "basic",
    "attemptNumber": 1
  },
  "session": {
    "completed": true,
    "coreGoalAchieved": true,
    "durationMinutes": null,
    "durationSource": "unknown",
    "usedJapaneseMostly": true,
    "coachHintCount": null,
    "communicationBreakdownCount": null
  },
  "scores": {
    "communication": { "score": 3, "confidence": "medium", "evidence": [] },
    "fluency": { "score": 3, "confidence": "medium", "evidence": [] },
    "pronunciation": { "score": null, "confidence": "insufficient", "evidence": ["语音证据不足"] }
  },
  "errorCounts": {
    "particle": null,
    "grammar": null,
    "keigo": null,
    "vocabulary": null,
    "pronunciation": null,
    "unnatural": null,
    "communicationBreakdown": null
  },
  "newWords": [],
  "sentences": [],
  "strengths": [],
  "weaknesses": [],
  "nextFocus": [],
  "recommendation": {
    "needsReinforcement": false,
    "reasonCodes": [],
    "reasonZh": "",
    "suggestedTopic": null,
    "suggestedDifficulty": null,
    "suggestedFocus": []
  },
  "summaryZh": ""
}
```

## 3. 类型与枚举

- `task.taskType`：`core`、`reinforcement`、`review`、`assessment` 或 `comprehensive`。
- `task.difficulty`：当天任务给出的字符串；未知为 `null`。
- `task.attemptNumber`、`coachHintCount`、`communicationBreakdownCount`：非负整数；无法可靠统计为 `null`。
- 三项 `score`：1～5 的整数或 `null`。
- `confidence`：`high`、`medium`、`low` 或 `insufficient`；分数为 `null` 时必须使用 `insufficient`。
- `evidence`、`strengths`、`weaknesses`、`nextFocus`、`reasonCodes`、`suggestedFocus`：字符串数组。
- `errorCounts` 各项：非负整数；无法可靠统计为 `null`，不得用猜测的 `0` 代替未知。
- `reasonCodes` 只允许 `COMMUNICATION_LOW`、`FLUENCY_LOW`、`PRONUNCIATION_LOW`、`CORE_GOAL_NOT_ACHIEVED`。

训练表现状态定义：

- 独立完成：无关键词、句首、选项或完整答案，经过正常重复、澄清后完成。
- 提示完成：获得关键词、句首或选项后完成。
- 跟读完成：教练给出完整句后复述。
- 未完成：在帮助和二次验证后仍不能完成目标表达。

`coreGoalAchieved` 是主题整体判定，不是“每一句都必须独立完成”。主要沟通流程能够独立完成，且大多数核心目标已独立完成或在二次验证中独立完成时使用 `true`。个别一至两个表达仍为提示完成、跟读完成或未完成时，把它们写入 `sentences`、`weaknesses` 和 `nextFocus`，但不单独触发整主题补强。只有核心任务无法独立推进、多个主要目标普遍依赖提示／完整答案，或关键沟通发生中断时使用 `false`。

`scores.*.evidence`、`strengths` 和 `weaknesses` 应明确写出相关表现属于哪种状态。跟读完成不得写入 `strengths` 作为掌握证据。

每条证据只能描述当前聊天中实际发生并可确认的表现。任务清单中列出的场景、目标或词汇不能自动写成训练事实；没有实际发生的延误、换乘、错单等场景不得出现在 `evidence`、`strengths` 或 `summaryZh`。AI 猜对用户意图、替用户补全句子或把错误回答当成正确回答，不得记为独立完成。

`newWords` 有可靠记录时，每项结构为：

```json
{
  "word": "持ち帰り",
  "reading": "もちかえり",
  "meaningZh": "外带",
  "exampleJa": null,
  "exampleZh": null,
  "priority": "medium"
}
```

`sentences` 有可靠记录时，每项结构为：

```json
{
  "original": "用户实际说过的日语原句",
  "isApproximate": false,
  "corrected": "推荐的自然日语句子",
  "meaningZh": null,
  "category": "expression",
  "explanationZh": "提示完成：获得句首后完成；更换条件后二次验证仍未独立完成。",
  "repeatCount": 1,
  "priority": "medium"
}
```

原句无法精确还原时，`original` 写明可确认的近似日语，并设 `isApproximate: true`。用户完全没有说出可还原原句、但关键表达未完成时，`original` 使用能确认的关键词或空缺表达并设 `isApproximate: true`，在 `explanationZh` 中说明“未完成”。用户没有实际表达过的完整错误句不得伪造成原句。

经二次验证仍为提示完成、跟读完成或未完成的关键表达，应写入 `sentences`。`explanationZh` 必须以“提示完成：”“跟读完成：”或“未完成：”开头；如果二次验证后独立完成但该句仍值得复习，可以用“独立完成：”开头。

当训练中存在多项已确认的高优先级困难时，应完整收录有学习价值的真实句子，而不是任意只挑一两句。包括只说出关键词、句子中断、用中文代替、由教练补全，或复测后仍未独立完成的目标表达。通常可优先保留 3～8 条，但不设置机械最低数量；没有可靠内容时宁可返回空数组，不得为了凑数编造。

## 4. 数据真实性与补强

- 不得编造训练时长；GPT‑Live 无法可靠取得时使用 `durationMinutes: null`、`durationSource: "unknown"`。
- 不确定的错误不计数，不确定的错误数量使用 `null`。
- 任务材料中的词不自动进入 `newWords`；但训练中已经证实用户听不懂、不会使用或反复混淆的词，应进入 `newWords` 作为复习词。用户明确表示想不起来、询问“怎么说”、用中文代替后由教练提供的关键词，也属于已证实困难，必须记录；例如想表达价格却说不出「値段」时，应收录「値段」。
- 教练必须提供后用户才能继续的关键词、因听不懂造成沟通阻塞的场景词，也属于已确认困难词。纯粹由错误转写产生、无法确认用户实际困难的词不得收录。已经观察到明确困难词时，不能返回空数组；但不设置固定数量，不为凑数收录任务材料。
- Voice 当时理解与会后转写冲突时，不把异常转写直接判为用户错误。韩文、乱码、错误地名或明显不合语境的文字不能直接作为 `sentences.original`；若仍能确认用户想表达的近似日语，使用 `isApproximate: true`，并在 `explanationZh` 说明转写不确定。不能由转写推导发音问题。
- 无论总结在 Live 内还是退出 Live 后生成，Pronunciation 是否评分只取决于是否有具体、可信的实际听觉证据。如果只能依据文字转写或无法提供具体证据，使用 `score: null`、`confidence: "insufficient"`。
- JSON 中的说明、依据、释义和总结使用中文；日语学习内容保留日语。
- 任一有效评分 ≤2 或 `coreGoalAchieved=false` 时，`needsReinforcement=true` 并填写对应原因代码。
- 三项有效评分均 ≥3 且 `coreGoalAchieved=true` 时，`needsReinforcement=false`、`reasonCodes=[]`。
- Pronunciation 为 `null` 不单独触发补强。
- 对于任务类型已经是 `reinforcement` 的课程，主要流程和大多数核心目标已经独立完成时，只把剩余弱句写入复习，不因单个复杂句再次建议完整主题补强。只有多个主要目标仍未完成、普遍依赖帮助或关键沟通持续中断时，才再次使用 `coreGoalAchieved=false`。

## 5. 输出前检查

1. 是否只输出一个带 `json` 语言标记的 Markdown 代码块，且代码块内只有一个 JSON 对象、代码块外没有其他文字；
2. 是否使用英文半角标点；
3. 是否包含原始 `taskId`；
4. 字段名和大小写是否完全一致；
5. 三项评分是否为小写对象结构；
6. 未知信息是否使用 `null` 而非编造；
7. 补强判断是否与评分和 `coreGoalAchieved` 一致；
8. 是否能被标准 JSON 解析器直接解析。
9. 是否把提示完成或跟读完成误写成独立掌握；
10. 二次验证后仍未独立完成的关键表达是否进入 `sentences`；
11. 训练中已确认困难的词是否合理进入 `newWords`。
12. 是否把任务清单中的场景或目标误写成已经发生的训练事实；
13. `strengths`、`weaknesses`、`coreGoalAchieved` 与 `needsReinforcement` 是否互相一致；
14. 是否错误声称用户没有使用中文，或把 AI 猜测理解写成独立完成；
15. Pronunciation 为 `null` 时，是否仍断言了未经证实的具体发音错误；
16. 明确观察到多项困难时，`newWords` 和 `sentences` 是否存在无理由遗漏。
