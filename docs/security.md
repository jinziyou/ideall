# 安全与隐私

## 会话

登录前先获取 Wonita 握手公钥。客户端生成临时 X25519 密钥对，直接使用 32 字节共享密钥执行 XChaCha20-Poly1305；认证密文按 `24-byte nonce || ciphertext || 16-byte tag` 编码为十六进制。

access token 与单次轮换 refresh token 作为一个版本化 JSON 信封写入平台安全存储：Android Keystore、Apple Keychain、Windows 凭据保护或 Linux Secret Service。并发刷新采用 single-flight，防止同一 refresh token 被重复消费。退出登录会尽力撤销服务端会话，并始终清除本地信封。

## 加密同步

同步码必须是 32 位十六进制字符串，由用户自行保管；服务器无法恢复。每个 scope 使用 HKDF-SHA256：

- salt：`ideall-sync-v1`
- ID info：`ideall-sync-{scope}-id-v1`
- encryption info：`ideall-sync-{scope}-enc-v1`

分片使用 AES-256-GCM 和 12 字节随机 nonce。AAD 绑定 schema、scope、generation 与 part index，防止跨范围、跨版本或重排替换。服务器仅看到派生同步 ID、密文大小和提交元数据。

丢失同步码意味着无法解密远端快照；泄露同步码则意味着持有者可以读取该码对应的三个范围。应用不会把同步码上传、自动备份或写入日志。

## 内容边界

- 不接受任意文件附件。
- 不执行文档中的代码、HTML、JavaScript 或插件。
- 外部链接仅允许 `http` 与 `https`，并交给系统浏览器。
- 发布阅读器使用受控 Markdown 渲染；嵌入图片不会触发隐式网络或本地文件读取。
- 本地 JSON 导入有 64 MiB 上限和 schema 标识检查。
- 服务地址必须为 HTTPS。

## 平台配置

Android 禁用应用数据自动备份，避免 Keystore 密钥与备份密文错配。Apple targets 声明 Keychain 权限；macOS 额外声明出站网络和用户选择文件读写权限。Linux 构建与运行需要 libsecret。
