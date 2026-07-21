# 签名运行时扩展包

本文定义桌面 App 当前可发现的运行时扩展发行格式与安全边界。概念模型见
[extensions.md](extensions.md)，Catalog 的授权与生命周期状态机见
[extension-registry-design.md](extension-registry-design.md)。

## 1. 当前范围

当前实现是**联网发现目录 + 本机签名包管理器**，不是自动安装市场：

- 仅 Tauri 桌面端启用；Web、Android 与 iOS 不发现或启动本机 connector。
- 宿主只扫描 `app_data_dir/extensions/` 固定目录，不接受网页、模型或 manifest 提供任意路径。
- 每个包是“Minisign 签名的 JSON 清单 + 清单摘要绑定的单个 MCP stdio 可执行文件”。宿主不会把包内 JavaScript 加载进 webview。
- `ideall.official` 继续复用 App 更新器的内置 Minisign 公钥；用户还可导入按 publisher 限域的第三方公钥根，确认界面会显示 publisher ID 和宿主计算的 SHA-256 指纹。
- 设置页通过原生文件选择器安装/更新 `.ideall-extension`、导入 publisher 根和签名撤销清单；网页、模型和包内容不能提交任意本机路径。
- 安装代码不授予权限。每个新版本仍必须进入 Catalog 的 `verify -> consent -> activate`，更新、回滚、publisher 撤销或摘要撤销都会停止旧 connector 并撤销旧 consent。
- connector 激活后按已授权的 `resources:read` / `tools:invoke` 发现有界资源与工具，并挂载独立只读 FileSystem；资源 metadata 与工具描述可进入统一搜索，工具调用经通用 FileAction 确认和本机脱敏审计。当前不会把该 FileSystem 自动授权给 Agent 或嵌入页。
- 用户可在设置页显式刷新固定官方 Registry。目录页逐页验签并缓存，但只提供发现元数据和签名包 HTTPS 地址；不会自动下载、安装、信任 publisher 或继承授权。

## 2. 安装产物、目录与清单

发行文件是一个严格 JSON envelope，建议扩展名为 `.ideall-extension`：

```json
{
  "schemaVersion": 1,
  "manifest": "{\"schemaVersion\":1,\"id\":\"acme.search\",...}",
  "signature": "untrusted comment: ...\nR...\ntrusted comment: ...\n...",
  "connectorBase64": "...standard-base64..."
}
```

- `manifest` 是将要写入 `manifest.json` 的**精确 UTF-8 字节**；Minisign 签名必须覆盖这串字节，签名后不能重新格式化。
- `signature` 是 Minisign signature 文件的完整文本；`connectorBase64` 使用标准 Base64，解码后最多 64 MiB。
- envelope 最多 96 MiB；宿主在写入前完成严格解析、publisher 选根、Minisign 验签、权限摘要和 connector SHA-256 校验。

安装成功后，宿主只在固定 App 数据目录维护以下结构：

```text
app_data_dir/
└── extensions/
    └── acme.search/             # 必须与 manifest.id 完全一致
        ├── manifest.json
        ├── manifest.json.minisig
        └── acme-search          # Windows 通常是 acme-search.exe
```

`extension-staging/` 用于同文件系统原子切换，`extension-backups/<id>/` 只保留最近一个已验证版本供显式回滚；这些目录不参与发现。

`manifest.json` 使用严格 schema；未知字段会使整个包被拒绝。签名覆盖文件的**原始字节**，不要在签名后重新格式化。

```json
{
  "schemaVersion": 1,
  "id": "acme.search",
  "label": "Acme Search",
  "version": 1,
  "publisher": "acme.official",
  "permissions": ["resources:read", "tools:invoke"],
  "connector": {
    "protocol": "mcp-stdio",
    "executable": "acme-search",
    "sha256": "64-character-lowercase-hex-sha256",
    "args": ["--stdio"]
  }
}
```

约束：

- `id` / `publisher` 只能使用小写 ASCII 字母、数字、`.`、`-`，首尾必须是字母或数字；`version` 是 JavaScript 安全正整数。
- `permissions` 非空、无重复并按字典序排列；当前只允许 `resources:read` 与 `tools:invoke`。
- `executable` 只能是单个安全文件名，不能包含路径分隔符、绝对路径、`.` / `..`；Unix 上必须具有可执行位。
- connector SHA-256 是文件内容的 64 位小写十六进制摘要。最多 32 个参数，参数不能含控制字符。
- 包数、清单、签名、connector、参数和双向 NDJSON 单消息均有硬上限；manifest、签名、connector、包目录均拒绝符号链接或非预期文件类型。

## 3. Publisher 根与撤销清单

第三方根文件使用严格 JSON：

```json
{
  "schemaVersion": 1,
  "publisher": "acme.tools",
  "label": "Acme Tools",
  "publicKey": "RW..."
}
```

宿主解析 Minisign 公钥，并以 `sha256:` + SHA-256 Base64URL（无 padding）计算指纹。设置页只在用户核对 ID/指纹并二次确认后写入 `extension-publisher-trust.json`。同一 publisher ID 直接提交不同公钥仍以 `publisher-key-conflict` fail closed；保持 ID 的密钥变更必须走下述双签名轮换协议。

密钥轮换文件使用严格信封，当前密钥和下一密钥分别对同一份原始 payload 签名：

```json
{
  "schemaVersion": 1,
  "payload": "{\"schemaVersion\":1,\"publisher\":\"acme.tools\",\"sequence\":2,\"issuedAt\":1784280000000,\"currentFingerprint\":\"sha256:...\",\"nextPublicKey\":\"RW...\",\"nextFingerprint\":\"sha256:...\"}",
  "currentSignature": "untrusted comment: ...\nR...\ntrusted comment: ...\n...",
  "nextSignature": "untrusted comment: ...\nR...\ntrusted comment: ...\n..."
}
```

- 新导入的第三方根从 `keySequence = 1` 开始；轮换 `sequence` 必须精确等于当前序列加一，`issuedAt` 必须晚于上一轮换且不能超过本机时间五分钟。
- `currentFingerprint` 必须匹配当前未撤销的 publisher 根；`nextFingerprint` 必须由 `nextPublicKey` 重新计算，并同时通过当前密钥授权签名与下一密钥持有证明。
- 信任库 schema v1 在读取时迁移为 v2。每次轮换把旧指纹加入最多 32 项的退役集合；任何后续轮换都不能恢复已退役指纹，因此旧轮换信封和密钥回滚 fail closed。
- 设置页先执行只读检查并展示 publisher、序列和新旧指纹；用户确认时宿主再次完整复验候选未被替换，再原子写入信任库。
- 轮换前前端协调层先停止该 publisher 的活动 connector 并撤销 consent。轮换后，旧密钥签名的当前包和单版本回滚副本都不会再通过 discover/verify/spawn；发行方必须提供由新密钥重新签名的包，用户重新安装并授权。
- 撤销清单按 publisher ID 保留，但轮换后的新清单必须由当前新密钥签名。已撤销 publisher 和官方内置根不能通过此用户导入协议轮换。

双签名适用于当前密钥仍受控的计划轮换，不是密钥泄露恢复协议：持有已泄露当前私钥的攻击者也能授权其自行生成的下一密钥。真正的 compromise recovery 仍需要独立离线恢复根或随 App 更新的官方信任声明。

撤销清单也是单文件 envelope，`payload` 的精确字节由对应 publisher 根签名：

```json
{
  "schemaVersion": 1,
  "payload": "{\"schemaVersion\":1,\"publisher\":\"acme.tools\",\"sequence\":2,\"issuedAt\":1784280000000,\"revokedDigests\":[\"sha256:...\"]}",
  "signature": "untrusted comment: ...\nR...\ntrusted comment: ...\n..."
}
```

- `sequence` 必须为单调递增的安全正整数；旧序列和重复序列都会拒绝。
- `revokedDigests` 是按字典序排列且无重复的 manifest 内容摘要，最多 4,096 项；新清单必须包含旧清单全部摘要，不能通过后续清单“取消撤销”。
- 导入后，discover、verify 和 spawn 都会重新检查 publisher 状态与摘要撤销；当前运行的受影响 connector 由前端协调层立即停止并撤销 consent。
- 用户也可本地撤销整个第三方 publisher 根。官方内置根不能从设置页撤销，但可导入由官方根签名的摘要撤销清单。

## 4. 安装、更新、回滚与启动事务

1. **install/update**：原生文件选择器返回 opaque path；Rust 有界读取并完整验证 envelope。新安装原子移入 `extensions/<id>`；更新只接受更大的 `version`，相同摘要幂等返回，等版本不同摘要和降级均拒绝。旧版本只保留一个回滚副本。
2. **registry update prepare**：设置页只把扩展 ID 交给 Rust。宿主从每次重新验签且未过期的 Registry 缓存选择条目，对包域名执行 DNS 解析、拒绝任一非全局地址并把请求钉连到已检查 IP；请求禁用代理、重定向和内容编码。响应限制 96 MiB，并依次绑定包文件 SHA-256、publisher 根、Minisign、撤销状态、manifest 摘要、版本与权限列表。通过后只在 App 数据区保留一个随机 token 命名的临时候选。
3. **registry update apply/discard**：确认页显示版本变化、新增/移除权限和 publisher 指纹。确认时 Rust 重新读取 Registry、检查序列与有效期、复算临时包 SHA 并再次完整验包；候选任一字段变化即拒绝。桌面协调层先停止旧 connector 并撤销旧 consent，再原子安装并保留上一版本。取消、应用完成或应用失败都会删除临时包；新版本不会继承旧授权。
4. **reconcile**：包身份变化、消失或信任失效时，Catalog 先停止旧 connector、撤销旧 consent、移除 factory，再发现新描述。新版本不会继承旧授权。
5. **rollback**：先停止并撤销当前版本，再原子交换当前目录与回滚副本；恢复版本仍需重新验证和授权。
6. **uninstall**：先完成运行时 teardown 和 consent 撤销，再删除当前代码与回滚副本；不会删除 connector 已产生的个人数据。

7. **discover**：Rust 从固定目录有界枚举，按 manifest.publisher 选择对应根，验证 Minisign、撤销状态、严格清单与 connector SHA-256；拒绝原因只以不含绝对路径的代码显示。
8. **verify**：用户授权前再次从磁盘复验，并把 `id + version + manifest digest + permission digest` 绑定到验证回执；第三方 verifier id 同时绑定 publisher 根指纹，完整 consent 回执只进入系统凭据库。
9. **spawn**：每次启动前第三次复验根状态、撤销清单、包和摘要，使用已签名路径与参数启动；工作目录固定为包目录。
10. **lifecycle**：先注册 Tauri 事件监听再启动进程；MCP 初始化或发现失败会进入 Catalog 诊断。卸载、撤销、factory 移除或激活回滚会先 abort/关闭 client，再终止 stdio 会话。

connector 进程使用清理后的环境，只保留平台启动所需的 `PATH`、用户目录、临时目录、locale 与 Windows 系统目录变量；stderr 当前丢弃，后续与 HTTP/SSE/stdio 一致诊断一起收口。

## 5. FileSystem、搜索与动作映射

- 每个活动 connector 挂载 `runtime-extension.<id>` FileSystem，根下只有按 manifest 权限出现的“资源”和“工具”目录。撤销、卸载或激活回滚会先关闭 client/process，再原子移除 mount。
- `resources/list` / `tools/list` 最多读取 32 页、512 个资源和 256 个工具；重复 URI/工具名、cursor 环、非法结构或超限身份会使激活失败。resource/tool FileRef 由私密 URI/名称的 SHA-256 生成，不在目录项、搜索项、日志或持久状态中暴露原始身份。
- 搜索按查询实时读取活动 mount，只使用标题、描述、媒体类型和 connector label；不读取或持久索引 `resources/read` 正文。资源实际打开时才按 URI 读取，单次内容限制 3 MiB，并对文本、base64 与多内容结果做有界规范化。
- 工具 schema 能安全投影到通用表单时使用受限 JSON-Schema 子集；复杂 schema 降级为最大 64 KiB 的 JSON 对象输入。外部工具默认按 destructive 处理，只有明确 `readOnlyHint` 才降为 caution，两类都必须确认。
- 调用工具前先经 `app.agent-write-audit` specialized action 写入不含参数的 pending 意图；失败则不调用 connector。明确成功/失败后原子结算；调用已返回但结算失败时保留 pending 并禁止自动重试。审计只保存 connector/tool 的脱敏标签与不透明 id，不保存参数、返回正文或远端错误。

## 6. 联网 Registry 协议

桌面宿主只访问固定端点 `https://api.wonita.link/v2/extensions/registry`，不接受渲染层传入 Registry URL，不跟随重定向，也不发送身份凭据。首次请求带 `limit=64`，后续只附加上一签名页给出的 opaque cursor。

每个 HTTP 页是严格 JSON 信封，`payload` 的精确 UTF-8 字节由官方 Minisign 根签名：

```json
{
  "schemaVersion": 1,
  "payload": "{\"schemaVersion\":1,\"registry\":\"ideall.official\",\"sequence\":7,\"generatedAt\":1784280000000,\"expiresAt\":1784884800000,\"cursor\":null,\"nextCursor\":\"next_1\",\"entries\":[]}",
  "signature": "untrusted comment: ...\nR...\ntrusted comment: ...\n..."
}
```

payload 条目包含 `id`、`label`、`summary`、`version`、`publisher`、`publisherFingerprint`、有序权限、manifest 内容摘要、`packageUrl`、包文件十六进制 SHA-256 与发布时间。宿主执行以下不变量：

- 最多 8 页、256 个条目；单页解压后最多 256 KiB，缓存最多 2 MiB；cursor 只能是 256 字节内的 ASCII token，拒绝环和不完整分页。
- 所有页必须共享 `registry`、`sequence`、`generatedAt` 与 `expiresAt`，游标必须与请求逐页吻合；条目 ID 在页内和跨页严格递增。
- 有效期最长 30 天，拒绝未来生成时间和联网取得的过期目录。缓存过期后仍可离线展示，但明确标为 stale。
- `packageUrl` 只允许无凭据、非自定义端口、无 query/fragment 的 HTTPS URL；目录权限仍只允许 `resources:read` 与 `tools:invoke`。
- 缓存保存原始信封而不是解析后的目录。每次读取缓存都重新验签并复查全部分页约束；损坏缓存 fail closed。

设置页读取只加载本地缓存，不在冷启动或普通浏览时隐式联网。用户点击“刷新目录”才访问 Registry；失败且存在可信缓存时返回缓存与稳定故障码。未安装条目仍可打开外部包地址；已安装且版本落后的条目显示“下载并检查更新”，由上述两阶段事务完成安全下载、权限差异确认与原子安装。当前没有后台静默检查或自动安装。

客户端协议和安全回退已经落地。生产发布链使用既有 updater Minisign Secret 每日生成短期有效信封，并通过 staging GitHub Release 原子切换固定通道；首次空目录 Release 已绑定稳定 main，下载摘要与 Minisign 独立验收通过。Wonita apiserver 只代理公开签名资产，不持有私钥；代理路由与桌面消费端现已统一为 V2，生产端点已返回有效的签名空目录信封。运维流程见 [Extension Registry 发布运维](extension-registry-operations.md)。

## 7. 安全边界与已知限制

- **进程外不是 OS 沙箱。** connector 仍以当前用户身份运行，可以按操作系统权限访问文件、网络和启动其他进程；manifest 权限控制 ideall 的 MCP 交互，不是内核级 capability。只应运行受信发行者的签名 connector。
- 当前只绑定一个主 executable。发行物应使用自包含二进制；若该程序主动加载旁路动态库、脚本或相邻数据，宿主不会替它验证这些二级依赖。
- Rust 在 discover、verify 和 spawn 都复验，显著缩短被替换窗口，但跨平台 `Command` 启动前仍不存在文件句柄级原子执行保证。同一用户下能并发修改 App 数据目录的恶意进程已超出这一层能完全隔离的范围。
- 官方包、Registry 和 App 更新仍共用一个 Minisign 运营根；第三方 publisher 使用独立根。当前更新检查与安装必须由用户从设置页明确触发，不做后台轮询、静默下载或静默授权。
- 第三方根与撤销清单是设备本机状态，不进入 workspace archive 或同步。根存储损坏时所有 package 操作 fail closed。
- 当前 connector FileSystem 只允许可信 UI 与精确活动 Engine 读取，工具 action 只允许显式 UI 调用；不会因 mount 存在而自动获得 Agent/iframe 权限。

## 8. 维护验证

修改格式、信任根、发现或启动逻辑时至少运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm test runtime-extension
pnpm typecheck
```

Rust 测试覆盖 Minisign 官方向量、Registry 原始 payload 验证、分页/排序/URL/权限约束、publisher store 完整性、摘要撤销、清单/权限/connector 绑定、路径穿越、符号链接、输入上限与脱敏拒绝报告；前端测试覆盖 Registry 原生契约、Settings FileSystem 刷新动作与状态 UI，以及 publisher/撤销/回滚、持久记录重新发现、拒绝诊断、factory 惰性创建、FileSystem 映射、URI 隐藏、资源读取、schema 降级、版本校验和审计先于副作用。
