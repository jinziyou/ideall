# Wonita 契约

默认 origin 为 `https://api.wonita.link`。客户端统一消费 Wonita `{data, meta}` 响应信封。

## 现有能力

- `GET /v2/app/auth/handshake/{client_id}`
- `POST /v2/app/auth/login`
- `POST /v2/app/auth/register`
- `POST /v2/app/auth/refresh`
- `POST /v2/app/auth/logout`
- `GET /v2/app/auth/session`
- `PUT /v2/app/me/profile`
- `POST /v2/data/corpus/articles/query`
- `GET /v2/data/corpus/articles/{article_id}`
- `/v2/app/sync/...` 分片与 manifest API

## 发布生命周期扩展

旧 `POST /v2/app/me/publications` 保持“直接公开发布”的兼容行为。新客户端使用：

- `POST /v2/app/me/publications/drafts`
- `GET /v2/app/me/publications/{publication_id}`
- `PUT /v2/app/me/publications/{publication_id}?expected={version}`
- `PUT /v2/app/me/publications/{publication_id}/state?expected={version}`
- `GET /v2/app/me/publications/{publication_id}/versions`
- `GET /v2/app/me/publications/{publication_id}/versions/{version}`
- `PUT /v2/app/me/publications/{publication_id}/restore?expected={version}`
- `DELETE /v2/app/me/publications/{publication_id}?expected={version}`
- `GET /v2/app/community/publications/{publication_id}`

发布字段：

- `state`: `draft | published | archived`
- `visibility`: `private | unlisted | public`
- `body_format`: `plain_text | markdown`
- `version`: 从 1 开始的单调整数

草稿与归档始终只有所有者可读。公开精确 ID 查询只返回已发布且为 `public` 或 `unlisted` 的内容；只有 `public` 会进入列表发现。不列出内容仍可通过精确链接访问。

所有内容或状态变更都会在事务内锁定当前行、检查 `expected`、追加不可变 revision，再更新 head。恢复旧版本同样追加 revision。`client_request_id` 保证草稿创建重试幂等。

公开页面地址为：

`https://www.wonita.link/community/publications/{publication_id}`

## 部署顺序

1. 部署 PostgreSQL migration。
2. 上线默认拒绝草稿/私有内容泄露的读取逻辑。
3. 等待旧 apiserver 实例排空。
4. 启用新写入端点。
5. 上线 Portal 公开页、BFF allowlist、OpenAPI 与客户端。

在第 2 步完成前，不应启用草稿写入。
