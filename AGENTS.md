# 项目协作规则

- 每次代码变更都同步到 `chuliangriu/zhihu-latest` 和 `feifanwang2-ops/zhihu` 的 `main`。前者连接现有 Vercel Production，后者保留同一份完整源码；同步后核对两边完整 Git tree 一致。若任一仓库出现未检查的新提交，先检查差异再同步，不强制覆盖远端历史。
- 按用户已确认的流程直接更新 `main`，不创建 PR；仅使用现有 Production，不创建 Preview，不更换 OAuth 回调地址。
- 密钥、`.env`、`.audit/` 和本地待办、查验报告不上传仓库；未经用户另行要求不改 README。
- 用户已于 2026-11-17 永久取消《小马过河》相似性检查及 `xiaomaguohe-guard`。不执行、不主动建议恢复；只有用户明确重新启用时才恢复。
