# 第三方组件与来源

VideoManager 使用 Electron (MIT)、React (MIT)、Cordis (MIT)、SQLite (公有领域)、better-sqlite3 (MIT)、Sharp (Apache-2.0)、libvips (LGPL-2.1-or-later)、Radix UI (MIT)、TanStack Query / Virtual (MIT)、Zustand (MIT)、Lucide (ISC)、Zod (MIT)、Ajv (MIT)、yauzl / yazl (MIT)、nlohmann/json (MIT)。各组件许可证随 npm 包保留。

原生 vm-media 动态链接 FFmpeg LGPL shared 构建。构建二进制及其源版本/摘要记录在 native/vendor/manifest.json 与发行目录 resources/native/ffmpeg-manifest.json。构建来源：[BtbN FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)，[FFmpeg 源码](https://ffmpeg.org/download.html)，[FFmpeg 许可说明](https://ffmpeg.org/legal.html)。FFmpeg 的许可文本随运行时分发。用户可替换兼容 ABI 的动态库；本软件不会限制为调试这些库修改而进行的逆向工程。

测试媒体由 scripts/fixtures.mjs 生成，不使用用户实际收藏。测试编码器仅用于本机生成样本，不随应用分发。

本交付为未签名的开发验收构建。公开分发前须按锁定二进制的配置归档对应源码、构建脚本及全部依赖许可，并完成发行审查与代码签名。

## mpv 播放器

安装包包含 mpv v0.41.0-1023-g69e63f425（2026-09-03 Windows x64 构建），来源为 mpv 官方安装页列出的 [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260903)。锁定下载地址及 SHA-256 见 native/mpv-dependency.json；运行时副本记录在 resources/native/mpv/source-manifest.json。

mpv 默认采用 GPL-2.0-or-later；版权说明和 GPL/LGPL 许可文本位于 resources/native/mpv/。mpv 以独立进程运行，通过本机命名管道控制；画面通过原生子窗口嵌入应用的播放弹窗。其内含的 FFmpeg、libplacebo、libass 等组件与本项目用于封面生成的 LGPL FFmpeg 动态库相互独立。对应 [mpv 源码](https://github.com/mpv-player/mpv/tree/69e63f425a) 与 [构建脚本](https://github.com/shinchiro/mpv-winbuild-cmake/tree/20260903) 记录于来源清单，分发者应同时保留所用构建及依赖的对应源码和许可。
