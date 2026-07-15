# 跨端同步合并策略：LWW 取舍 + 删除传播（决策记录）

> **状态：已落地。** 对应审计项 **Low-6**（跨端 LWW 取舍 + 删除不传播）。
> 实现：`@protocol/sync`（纯合并/GC 逻辑 + 单测）、`@protocol/storage-sync`（本地快照 CAS）、`src/files/stores/subscriptions-store.ts`（软删除/复活/读路径过滤/GC 落地）、`src/plugins/sync/lib/sync-domain-runner.ts`（关注/笔记共用编排）。

## 背景

跨端同步（端到端加密、无账号，但需要可用的 Sync 服务；见 [README](../README.md) / [development.md](development.md)）把「发现」关注在多设备间对齐：
本地优先存于 IndexedDB，同步时**只上传密文**（`storageId` + AES 密钥由同步码派生）。
服务端是不透明密文存储，**不参与合并**——合并逻辑全在客户端。多端可并发改同一份关注集，
故需要一个确定性、可结合、幂等的合并函数。

## 决策一：合并用 LWW（last-write-wins）并集

**选 union-merge + 按 `updatedAt` 的 LWW**（`@protocol/sync#unionMerge`）：

- 按 `id` 取本地 ∪ 远端；同 `id` 取 `updatedAt` 较新者胜，并列本地优先（稳定）。
- 幂等 + 可结合：每轮把新拉到的远端并入累积 `merged` 即可，天然支持「409 重试→重新 GET→再合并」。

**为什么不用更强的 CRDT（如逐字段 OR-Set / 版本向量）？**

| | LWW 并集（选定） | 逐字段 CRDT / 版本向量 |
|---|---|---|
| 复杂度 | 低（一个纯函数 + 单测） | 高（每字段元数据、因果序、合并规则） |
| 收益对关注场景 | 足够：关注是小粒度记录，字段冲突罕见且无损要求低 | 过剩：为「同字段并发改」保真，但关注几乎不存在此模式 |
| 数据量 | 关注数量级为「十～百」，整集合并成本可忽略 | 元数据开销与同步块体积上升 |
| 可审计性 | 合并结果一眼可推（看 `updatedAt`） | 需理解因果元数据 |

**取舍代价（已知且接受）**：同一关注在两端「同一毫秒」内被改时，按「本地优先」任选其一——
对关注这种低冲突、字段无损要求低的数据，可接受。若未来有高保真合并需求（如富文本笔记同步），
另选 CRDT，不复用本策略。

## 决策二：删除用墓碑（tombstone）传播，而非物理删

**问题（旧实现）**：删除是**物理删** + 合并是**并集**——在 A 端取消关注某来源，B 端仍持有它，
下次同步 `unionMerge` 把它从 B 带回 A，**删除被「复活」**。即「删除不传播」。

**选 tombstone 软删除**（让删除也走同一条 LWW，从而跨端收敛）：

- `removeSubscription` 写 `deletedAt` 墓碑（并 bump `updatedAt`），而非 `idbDelete`。墓碑只是一条
  `deletedAt` 已设的 `Subscription`，**原样参与 `unionMerge`**：
  - 删除较新 → 墓碑胜 → 删除跨端收敛（不再被对端活跃副本复活）。
  - 删除后又重新关注（`addSubscription` 命中墓碑则**复活**：清 `deletedAt` + 新 `updatedAt`）较新 → 活跃项胜。
- **读路径过滤**：`listSubscriptions` / `isSubscribed` 只返回活跃项（`isLive`），UI/插件/嵌入桥无感。
- **同步读含墓碑**：新增 `listAllSubscriptions`（墓碑须进合并/上传才能传播），UI 读路径仍走 `listSubscriptions`。

### 墓碑 GC

墓碑若永不清除会无限累积、撑大加密同步块。但**清早了会复活**（某端尚未见过该删除时，
它的活跃副本会盖过已消失的墓碑）。故按**保留期**折中：

- `TOMBSTONE_TTL_MS = 90 天`：远超任何合理的多端离线窗口；超过即视为所有端已收敛，可安全物理清除。
- `pruneExpiredTombstones`（纯函数，`now` 注入）在同步落地/上传前剔除过期墓碑，使**本地与远端同步块都不再累积**。
- 落地侧：`bulkPutSubscriptions` 整批写入合并 + GC 后的集合，并物理删除墓碑——但删除判定**据落地时刻 fresh 重读的真实库状态**
  （`expiredTombstoneIdsToDelete`：库中当前已过期、且不在本批集合里的墓碑），**而非调用方的同步快照**。
  这样绝不会误删同步往返窗口内并发新增的活跃关注（本轮未上传，下轮自然带上），也不会删掉正被写回的复活项。
  > **注（避坑）**：早期实现曾用「删除库内不在本批集合的所有 id」做 reconcile，会把同步 await 窗口内并发 `addSubscription` 的新关注
  > 误判为陈旧而物理删除（静默数据丢失）。修正为「只删确属过期墓碑的 id」。`expiredTombstoneIdsToDelete` 有纯逻辑单测守此。

## 决策三：同步落地使用本地快照 CAS

网络 409 只能保护远端 blob，不能保护 GET/解密期间发生的本地编辑。同步状态因此区分两份本地状态：

- `localAll` 是同步开始时的不可变统计基线；
- `localSnapshot` 是下一次本地提交的期望快照，每次成功落地后推进为 Storage 返回的实际规范化快照。

`bulkPutSubscriptions` / `bulkPutNotes` 在同一个 IndexedDB readwrite 事务内 fresh 读取当前 kind，只有当前逻辑快照仍等于 `expectedLocal` 时才写入合并结果与 tombstone GC。当前状态已经等于目标时允许幂等成功；真实不一致则抛 `StorageSyncConflictError`，整批不写、也不发送远端 PUT，用户重试后会从新的本地快照重新合并。远端 PUT 返回 409 时，下一轮同时携带上次实际提交快照作为 `merged` 和本地 CAS 基线，不把调用方猜测的输入当作已提交状态。

关注和笔记的 live↔tombstone 转换、GC 与本机 `trash_snapshots` 在同一跨 store 事务提交；新同步 id 使用 `add`，不会覆盖同主键的其它 Node kind。关注入站还要求规范 `type/key/id`、安全 tool URL 与严格 sort key，损坏数据 fail closed。

## 已知局限（接受 / 留待）

1. **版本偏斜下的墓碑**：旧版客户端（不识别 `deletedAt`）会把墓碑当活跃项渲染并回传，削弱删除收敛。
   缓解：App 已启用自动更新（见 [docs/app.md](app.md)），版本偏斜窗口有限。`isValidRemoteSub` 已容忍墓碑字段。
2. **90 天内频繁删/关注累积墓碑**：体积影响对「十～百」量级关注可忽略；不优化。
3. **同毫秒并发改**：按决策一「本地优先」任选其一，接受。
4. **同步往返窗口内的并发本地写**：若本轮需要落地远端变化，本地快照 CAS 会拒绝覆盖并发 add/edit/move/remove，用户需重试同步；若合并结果无需写本地，窗口内的新本地变化不会丢失，但可能要到下一轮才上传。这是“安全失败 / 最终补传”的取舍，不自动吞冲突继续合并。

## 验证

`src/protocol/sync.test.ts` 覆盖删除收敛与 GC；`subscription-sync.test.ts` 覆盖真实远端推进后的 409、提交快照规范化、本地 CAS 冲突不 PUT 与重试上限；store 测试覆盖跨 kind 碰撞、事务回滚和 tombstone/恢复/GC 快照生命周期。

## 关联

- 纯合并/GC 契约：`@protocol/sync`。同步编排：`src/plugins/sync/`。
- 同步加解密：`src/lib/sync-crypto.ts`。本地 CAS 与远端 409 重试见 `sync-domain-runner.ts`。
- 关注类型（含 `deletedAt`）：`@protocol/subscription`。
