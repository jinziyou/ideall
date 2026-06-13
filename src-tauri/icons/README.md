# 应用图标

各平台图标由一张高分辨率源图生成（建议 1024×1024 PNG，透明背景）：

```bash
pnpm tauri icon path/to/icon-1024.png
```

会在本目录生成 `32x32.png` / `128x128.png` / `128x128@2x.png` / `icon.icns`（macOS）/ `icon.ico`（Windows）及 Android/iOS 各尺寸资源（`tauri.conf.json#bundle.icon` 引用这些文件）。

> `pnpm app:dev`（开发壳）无需图标即可运行；`pnpm app:build`（打包）需要先生成。生成后将图标提交进仓库。
