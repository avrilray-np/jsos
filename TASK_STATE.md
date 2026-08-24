# JSOS TASK STATE

> 最后更新：2026-08-24（Asia/Shanghai）

## 当前目标

- JSOS V1.1 第一至五阶段已完成生产发布、验收和收尾，进入实际使用观察期。
- 后续新增功能归入 V1.2；最终图文和录屏使用指南也在 V1.2 根据真实使用流程制作。
- 保持 Sites 外层公开、JSOS 内部必须登录，以及凌晨 1:00 训练日／顺延／补强逻辑。

## 已完成

- 第一阶段已验收：昨日复习、跨计划词句累计、JSON 安全解析与兼容修复、当前训练日导入限制、返回按钮、详情文案及统一 GPT-Live 规范均已上线。
- 第二阶段已验收：Supabase 多账号登录、首次密码提示、修改密码、实名反馈、私有图片、管理员反馈管理，以及数据库 RLS 与接口双层权限控制均已上线。
- 当前生产版为 Sites 版本 9，网址为 `https://jsos-japanese-speaking-os.avrilray.chatgpt.site`；未来计划日期可进入任务预览，GitHub `main` 功能提交为 `9338c9f`。
- 远端 Supabase 已应用迁移 `0001`–`0009`；本地与远端迁移清单一致。
- 第三阶段本地实现完成：计划草稿、1～90 天主题生成／编辑／60 秒恢复、启用日期、旧计划归档、逐日完整内容后台任务、三次自动重试、错误编号、手动重试和幂等恢复。
- Google Cloud 项目、赠金结算和 Vertex AI 权限已核对；专用运行账号仅授予 Vertex AI User，并采用 ADC，不使用 API Key。
- Gemini Gen2 云函数 `jsos-gemini-endpoint` 已在 `asia-northeast1` 部署并处于 ACTIVE；最小实例 0、最大实例 6、512 MB、120 秒超时，使用 `gemini-2.5-flash`。
- Gemini 服务支持主题、完整每日任务和谨慎 JSON 修复三类结构化生成；共享密钥、请求大小、超时、Schema 和脱敏用量日志已落实。
- 真实生成复测通过：3 天主题约 5.5 秒；完整每日任务约 16.9 秒，包含 3 个场景、5 条目标表达、10 条预热内容并通过 JSOS 结构校验。
- 按实测 token 与当前 Vertex AI 标准价估算，30 天完整计划约 US$0.28，不含失败重试；云函数按需启动成本预计很小。
- Sites 运行环境中的 Gemini 服务地址、Gemini 密钥和 CRON 密钥已随版本 8 部署生效。
- Google Cloud Scheduler 已启用每分钟后台任务；JSOS 每次并行处理最多 6 天，目标为约 5 分钟完成 30 天内容，空队列检查不会调用 Gemini。
- 已创建仅统计 JSOS 项目的 NT$300 月预算，启用 50%／80%／100% 默认邮件提醒并计入赠金抵扣后的实际支出。
- 已停用错误的旧服务密钥版本 1，版本 2 正常；停用后真实生成复测通过。本地临时密钥副本已删除。
- 两个未使用的早期 Cloud Run 服务 `jsos-gemini-generation`（`asia-east1`、`asia-northeast1`）已删除；当前仅保留由 Cloud Functions 管理的生产服务 `jsos-gemini-endpoint`。
- 外部 V1.1 需求文档、仓库实施计划和 Gemini 服务说明已更新为最终 Gen2 Cloud Function／Vertex AI Gemini 方案，并补充未来任务预览及 V1.2 指南决定。
- 当前完整构建、主站 25 项测试、生成服务 4 项测试、ESLint 和 `git diff --check` 均通过。

## 正在处理

- V1.1 没有待开发或待发布功能；生产环境保持 Sites 版本 9、Supabase 迁移 `0001`–`0009`、Gemini 云函数和每分钟 Scheduler 正常运行。
- 使用指南保持当前临时文字版，不在 V1.1 继续调整。

## 当前问题

- 当前无阻塞 V1.1 使用的问题；后续根据真实用户反馈处理缺陷。
- `npx tsc --noEmit` 仍受仓库既有 Cloudflare 类型缺失影响；Vite/Vinext 正式构建已通过。

## 下一步

1. 观察 V1.1 实际使用情况；现有功能异常按 V1.1 缺陷修复处理。
2. 新功能、最终图文说明和录屏指南统一进入 V1.2。
