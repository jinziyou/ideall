# 移动端系统分享接入与验收

## 当前状态

跨端接收契约已经落地：Android/iOS 都注册 `ideall://capture`，冷启动和运行中的 URL 会进入同一原生待处理队列；Tauri `RunEvent::Opened` 收到可访问的 `file://` 资源时也会复用 HTML/PDF/图片导入链。

仓库尚未生成 `src-tauri/gen/android` 与 Apple Xcode 宿主。本机没有 Android SDK/ADB，且 Linux 无法生成、签名或运行 iOS 宿主，因此系统分享面板中的 `ACTION_SEND` / Share Extension 文件流仍是平台交付项，不能以未编译模板冒充已完成能力。

## 共用安全契约

- URL 只接受 `http` / `https`，清除 userinfo，最大 8 KiB。
- 文件只接受 HTML、PDF 与明确的图片扩展名。
- 单文件最大 32 MiB；原生待处理编码载荷总量最大 64 MiB，最多 16 项。
- 原生队列只表示“已接收”，不是提交回执；前端排空后仍须经过 FileSystem、URL 去重与收件箱标签写入。
- 分享扩展不得直接访问 IndexedDB，也不得把 security-scoped URL、Android `content://` URI 或临时授权句柄持久化到 Node。

## Android 宿主接入

在具备 Android SDK、NDK 和 `adb` 的 Linux/macOS 环境运行 `pnpm tauri android init`。生成宿主后：

1. 为 `text/plain`、`image/*`、`application/pdf` 注册 `android.intent.action.SEND` 与 `SEND_MULTIPLE`。
2. URL 文本规范化为 `ideall://capture?url=...`；文件 URI 必须在授权仍有效时通过 `ContentResolver` 复制为有界字节。
3. 冷启动与 `onNewIntent` 必须调用同一 Rust 队列桥，不能各自写入业务存储。
4. 拒绝目录、未知 MIME、超过上限或无法读取的 URI，并把逐项错误交给收件箱反馈。

验收命令应覆盖冷启动与热启动：

```sh
adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT https://example.com
```

还需从系统相册和文件管理器分别分享一张图片与一个 PDF，确认重复 URL 不新增对象、失败项不回滚成功项。

## iOS 宿主接入

在 macOS + Xcode 环境运行 `pnpm tauri ios init`。生成宿主后建立 Share Extension 与 App Group：

1. URL 通过自定义 scheme 唤起主 App。
2. 图片/PDF 先复制到 App Group 临时目录，再传递一次性 handoff 标识；主 App 读取后立即删除临时文件。
3. Share Extension 与主 App 共用相同类型、数量和体积上限；禁止把原始安全作用域 URL写入业务数据。
4. 主 App 冷启动、后台恢复和已运行三种状态均须排空同一 Rust 队列。

验收需从 Safari、照片和“文件”App 分别分享 URL、图片和 PDF，并验证取消分享不会产生收件箱对象。
