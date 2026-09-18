<div align="center">
  <img src="build/icon.svg" width="96" height="96" alt="VideoManager Logo" />
  <h1>VideoManager</h1>
  <p><strong>离线优先的 Windows 本地图片与视频管理工作台</strong></p>
  <p>保留原有文件结构，用封面、标签、收藏与统一视图整理你的本地媒体库。</p>

  <p>
    <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows11&logoColor=white" alt="Windows 10 / 11" />
    <img src="https://img.shields.io/badge/architecture-x64-4C8BF5" alt="x64" />
    <img src="https://img.shields.io/badge/version-0.1.0-18A058" alt="Version 0.1.0" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-2EA44F" alt="GNU GPL v3.0" /></a>
    <img src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white" alt="Electron 44" />
    <img src="https://img.shields.io/badge/privacy-local--first-7357C8" alt="Local first" />
  </p>
</div>

---

## ✨ 项目简介

VideoManager 是一款面向 Windows 的本地多媒体管理软件。它直接连接电脑中的图片和视频文件夹，不复制原始媒体，也不要求登录账号或连接云端服务。

应用会在本机建立媒体索引，并保存标签、收藏、播放进度、文件夹封面和视频封面等管理信息。即使磁盘暂时离线，已有索引和缓存封面仍然可以浏览。

> [!IMPORTANT]
> 重命名、移动和移入回收站会真实修改磁盘文件。VideoManager 会在执行前展示影响范围，并通过冲突检测、跨盘校验和操作记录降低误操作风险。

---

## 🌟 核心特性

- **本地媒体库** — 直接纳管现有文件夹，媒体保留在原位置，无需导入副本。
- **图片与视频统一浏览** — 网格和详细列表两种布局，文件夹与直属媒体分区展示。
- **高效索引** — 后台扫描、文件变化监听、任务进度显示和大列表虚拟化。
- **多维搜索** — 支持按文件名、文件夹名、路径和标签搜索，并可组合类型、扩展名、大小、日期、时长及收藏状态筛选。
- **内置查看器** — 连续浏览图片和视频，支持缩放、旋转、倍速播放、续播和全屏模式。
- **自定义封面** — 文件夹和视频均可设置封面；支持推荐候选、外部图片以及视频精确选帧。
- **标签与收藏** — 管理信息独立存储，不修改原始媒体文件。
- **安全文件操作** — 支持重命名、移动和移入系统回收站；跨盘移动会进行 SHA-256 校验。
- **离线与重绑** — 磁盘离线时保留管理数据，迁移媒体后可重新绑定资源根目录。
- **媒体库迁移** — 可导出和导入 `.vmlibrary` 管理包，不在管理包中复制原始媒体。
- **可扩展架构** — 导航、内容布局、查看器、封面策略和文件操作通过插件槽位组织。

---

## 🚀 快速开始

### 安装应用

1. 前往项目的 [GitHub Releases](../../releases/latest) 页面。
2. 下载 `VideoManager-<版本>-Windows-x64-Setup.exe`。
3. 运行安装程序，并按向导选择安装位置。

> [!NOTE]
> 当前安装包尚未进行数字签名，Windows SmartScreen 可能显示安全提示。请只从本项目的正式 Release 页面下载安装包。

### 添加媒体目录

1. 启动 VideoManager，点击 **添加资源目录**。
2. 选择图片和视频所在的本地文件夹。
3. 应用将在后台建立索引；可在 **后台任务** 中查看扫描进度。
4. 使用 **当前目录**、**包含子目录** 或 **整个媒体库** 切换浏览范围。

### 整理媒体

- 双击图片或视频进入查看器。
- 右键媒体卡片可收藏、编辑标签、设置封面或定位文件。
- 对视频选择 **设置封面**，可播放定位并精确选择某一帧。
- 使用顶部搜索框查询文件名、文件夹名、路径或标签。

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + F` | 聚焦搜索框 |
| `Ctrl + A` | 冻结当前查询结果并全选 |
| `Ctrl` + 单击 | 多选或取消选择 |
| `Shift` + 单击 | 连续范围选择 |
| `方向键` | 在资源间移动选择 |
| `Enter` | 打开选中项 |
| `Space` | 快速预览 |
| `Alt + ← / →` | 后退或前进 |
| `Alt + ↑` | 返回上一级目录 |
| `Delete` | 打开移入回收站确认窗口 |
| `F5` | 刷新当前显示 |
| `Esc` | 关闭弹窗或取消选择 |

---

## 🎞️ 媒体支持

| 类型 | 格式 |
| --- | --- |
| 图片 | JPEG、PNG、WebP、GIF、BMP |
| 视频发现与管理 | MP4、M4V、WebM、MOV、MKV、AVI、WMV、FLV、MPEG、MPG、TS、MTS、M2TS |
| 已验证的内置播放组合 | MP4（H.264 + AAC）、WebM（VP9 + Opus） |

部分视频容器或编码可能无法由内置播放器解码。此类文件仍可被索引、搜索和管理，并可通过系统默认应用打开或指定自定义封面。

---

## 🔒 隐私与数据

- 不需要账号，不上传原始媒体，也不依赖远程媒体服务。
- 原始图片和视频始终保留在用户选择的目录中。
- 标签、收藏、索引、播放进度和封面数据保存在本机。
- 默认数据目录为 `%APPDATA%\VideoManager\`。
- 清理缩略图缓存不会删除标签、收藏或手动封面。
- 导出的 `.vmlibrary` 管理包不包含原始媒体文件。

主要数据布局：

```text
%APPDATA%\VideoManager\
├── catalog.json                 # 媒体库目录
└── libraries\<library-id>\
    ├── library.sqlite           # 索引与管理信息
    ├── objects\                 # 手动封面对象
    ├── cache\                   # 可重新生成的缩略图缓存
    ├── temp\                    # 临时媒体处理文件
    └── logs\                    # 本地诊断日志
```

如需手工备份应用数据，请先完全退出 VideoManager，再复制整个数据目录。不要只复制正在使用的 SQLite 主文件。

---

## 🧱 项目结构

```text
videoManager/
├── apps/desktop/src/
│   ├── main/                    # Electron 主进程、媒体与文件操作服务
│   ├── preload/                 # 沙箱化、类型化 IPC 桥接
│   ├── renderer/                # React 用户界面与查看器
│   └── workers/                 # 索引、数据库和图像处理工作进程
├── packages/
│   ├── contracts/               # Zod 协议、DTO 与公共类型
│   ├── domain/                  # 查询、排序和领域规则
│   ├── persistence/             # SQLite 数据层
│   ├── platform/                # 原生能力适配
│   ├── design-system/           # 主题与设计变量
│   └── cordis-adapter/          # 插件生命周期适配层
├── native/
│   ├── filesystem/              # Win32 文件操作与身份识别
│   ├── media/                   # FFmpeg 解码与精确选帧
│   └── dependencies.json        # 原生依赖版本及摘要
├── plugins/                     # 内置插件
├── scripts/                     # 构建、发布和回归脚本
├── tests/                       # 单元、集成和性能测试
├── docs/                        # 产品、架构与交付文档
└── build/                       # 安装包图标等发布资源
```

### 数据流概览

```text
React Renderer
      │  typed IPC
      ▼
Electron Main Process
      ├── SQLite workers ──────▶ 索引、标签、收藏、播放记录
      ├── Index worker ────────▶ 目录扫描与文件变化监听
      ├── Image worker ────────▶ 缩略图、裁剪与画面评分
      └── Native processes ────▶ Win32 文件操作与 FFmpeg 解码
```

---

## ⚙️ 技术栈

| 领域 | 技术 |
| --- | --- |
| 桌面运行时 | Electron 44 |
| 用户界面 | React 19、Radix UI、Lucide、Zustand |
| 构建工具 | TypeScript 7、Vite 6、electron-vite |
| 查询与虚拟化 | TanStack Query、TanStack Virtual |
| 数据存储 | SQLite、better-sqlite3、WAL |
| 图像处理 | Sharp |
| 视频处理 | FFmpeg 8 动态库、原生 C++ 解码进程 |
| 插件系统 | Cordis |
| 测试 | Vitest、Playwright |
| 安装包 | electron-builder、NSIS |

---

## 🛠️ 本地开发

### 环境要求

- Windows 10 或 Windows 11 x64
- Node.js `22.12+`
- npm 或 pnpm
- 构建原生组件时需要 Windows x64 MinGW-w64 C++17 工具链

### 安装依赖并启动

```powershell
npm ci
node node_modules/electron/install.js
node scripts/fetch-native.mjs
powershell -ExecutionPolicy Bypass -File scripts/build-native.ps1
npm run dev
```

可通过 `VM_CXX` 环境变量指定 `g++.exe`：

```powershell
$env:VM_CXX = "C:\path\to\g++.exe"
npm run build:native
```

FFmpeg SDK 和 nlohmann/json 的来源、版本及 SHA-256 摘要记录在 [`native/dependencies.json`](native/dependencies.json) 中。请勿在没有兼容性回归的情况下直接升级 Electron、FFmpeg、SQLite 或 Cordis。

---

## 📦 构建与发布

生成 Windows x64 NSIS 安装包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

构建脚本会依次完成：

1. TypeScript 类型检查；
2. Electron 主进程、预加载和渲染器生产构建；
3. Windows x64 应用打包；
4. NSIS 安装程序生成。

输出文件位于：

```text
release/
├── VideoManager-<版本>-Windows-x64-Setup.exe
├── VideoManager-<版本>-Windows-x64-Setup.exe.blockmap
└── win-unpacked/
```

发布前可执行：

```powershell
node scripts/verify-release.mjs
```

`release/` 是生成目录，不应提交到 Git。正式安装包应上传为 GitHub Release 附件，并同时提供 SHA-256 校验值。

---

## ✅ 验证

```powershell
# 单元与集成测试
npm test

# 桌面端到端回归
npm run test:e2e

# 性能与跨盘操作
npm run test:performance
npm run test:cross-volume
```

测试数据生成、最终安装包回归和性能口径详见 [`docs/DELIVERY_REPORT.md`](docs/DELIVERY_REPORT.md)。测试脚本只使用隔离样本目录，不应指向个人媒体库。

---

## 📚 文档

- [产品需求文档（PRD）](docs/PRD.md)
- [技术架构与实现设计（TRD）](docs/TRD.md)
- [交付与验收记录](docs/DELIVERY_REPORT.md)
- [第三方组件与许可证说明](docs/THIRD-PARTY-NOTICES.md)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。提交代码前请确保：

```powershell
npm run build
npm test
```

建议使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 风格编写提交信息：

```text
feat: add new media filter
fix: refresh cover after frame selection
refactor: simplify index task lifecycle
docs: improve build instructions
```

提交问题时，请附上系统版本、VideoManager 版本、复现步骤和已脱敏的诊断信息；请勿上传包含个人媒体路径的截图或日志。

---

## 📄 许可证

VideoManager 采用 [GNU General Public License v3.0](LICENSE) 开源，仅适用 GPL 第 3 版（`GPL-3.0-only`）。你可以在遵守许可证条款的前提下使用、研究、修改和分发本项目；分发修改版本或二进制文件时，需要依照 GPL v3.0 提供相应源代码及许可证声明。

第三方依赖的许可信息请参阅 [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md)。
