# JSOS 总结 JSON 规范 v1.0

最终回答只能包含一个合法 JSON 对象。必须返回 `schemaVersion: "1.0"`、`rubricVersion: "1.0"` 和原始 `taskId`。未知单值使用 null，没有内容的集合使用空数组。

```json
{
  "schemaVersion": "1.0",
  "rubricVersion": "1.0",
  "task": { "taskId": "task_xxx", "dayNumber": 3, "topic": "餐厅", "taskType": "reinforcement", "difficulty": "intermediate", "attemptNumber": 2 },
  "session": { "completed": true, "coreGoalAchieved": true, "durationMinutes": null, "durationSource": "unknown", "usedJapaneseMostly": true, "coachHintCount": 0, "communicationBreakdownCount": 0 },
  "scores": {
    "communication": { "score": 3, "confidence": "high", "evidence": [] },
    "fluency": { "score": 3, "confidence": "high", "evidence": [] },
    "pronunciation": { "score": null, "confidence": "insufficient", "evidence": ["语音证据不足"] }
  },
  "errorCounts": { "particle": 0, "grammar": 0, "keigo": 0, "vocabulary": 0, "pronunciation": 0, "unnatural": 0, "communicationBreakdown": 0 },
  "newWords": [],
  "sentences": [],
  "strengths": [],
  "weaknesses": [],
  "nextFocus": [],
  "recommendation": { "needsReinforcement": false, "reasonCodes": [], "reasonZh": "", "suggestedTopic": null, "suggestedDifficulty": null, "suggestedFocus": [] },
  "summaryZh": ""
}
```

不得仅因任务资料出现某个词就判定用户不会。原句无法精确还原时必须设置 `isApproximate: true`。不确定的错误不计数，不得编造精确训练时长。
