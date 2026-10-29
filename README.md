# AI Reference Gallery

> 一个轻量、零依赖、可离线使用的 AI 创作参考图库。集中管理人物姿势与服装穿搭参考素材，提供简体中文、English、日本語三语界面。
>
> A lightweight, dependency-free reference gallery for AI art and illustration, with offline pose and costume browsing.

**项目状态：姿势与服装图库均已接入。** 本仓库是素材**浏览和管理工具**，并不提供 AI 图片生成功能。

## ✨ 项目特色

- **克隆即用**：源码与全部原始素材一同纳入 Git 仓库，`git clone` 完成后双击 `index.html` 即可离线打开；无需额外下载素材包。
- **三语界面**：简体中文 / English / 日本語，支持切换并保存语言偏好。
- **姿势检索**：支持编号、关键词、系列、分类及视角筛选。
- **服装检索**：支持按季节、类别、编号和穿搭关键词筛选，切换姿势 / 服装两类图库。
- **灵活查看**：可按姿势组或逐张图片浏览；支持缩略图、原图预览、原图下载及键盘导航。
- **分页加载**：按批次展示图库内容，减少一次性渲染大量卡片的开销。
- **静态部署**：页面可部署到支持静态文件的网站托管平台；运行不需要 Python、Node.js 或数据库。
- **可扩展索引**：使用浏览器可直接加载的 JavaScript 目录文件组织授权素材，便于更换为自己的素材库。

## 📚 当前素材与进度

| 素材 | 索引规模 | 当前状态 |
| --- | --- | --- |
| 姿势（Pose） | 1,439 张图片 / 288 组姿势 / 4 个系列 | **已可浏览**，原图与缩略图均已核对存在 |
| 服装（Costume） | 1,407 套服装，含季节、风格等分类 | **已接入浏览与筛选**，原图、预览图和缩略图均已核对存在 |

服装部分现包含 **1,407 张 PNG 原图、1,407 张 WebP 预览图、1,407 张 WebP 缩略图**，索引与文件存在性已通过自动化检查。实际发布前仍建议进行浏览器端的完整交互验收。

## 🚀 本地使用

1. 执行 `git clone <仓库地址>`（或者下载包含完整图片的仓库）。
2. 进入克隆后的目录，双击根目录下的 `index.html`。
3. 在页面顶部选择「姿势素材」或「服装素材」，在右上角切换语言。
4. 通过搜索、分类和视角（姿势模式）等条件筛选；点击卡片查看大图或下载原图。
5. 使用方向键切换图片，`Esc` 关闭预览；图片较多时点击「加载更多」。

不需要执行 `npm install`、启动服务器或连接互联网。项目通过 `<script src="catalog.js">` 加载索引，避免在 `file://` 环境下使用 `fetch()` 读取 JSON 时出现的跨域问题。

**提示：** 直接通过 `file://` 打开时，部分浏览器可能将图片直接打开，而不是按“下载”链接保存。

## 🧩 技术栈

| 层面 | 使用技术 |
| --- | --- |
| 页面结构 | HTML5 |
| 界面样式 | CSS3 / 响应式布局 |
| 交互逻辑 | 原生 JavaScript |
| 国际化 | 自定义 `i18n.js`（中 / 英 / 日） |
| 素材索引 | 本地 JavaScript 数据文件 |
| 运行方式 | 浏览器直接打开或静态站点部署 |
| 测试工具 | Node.js 内置测试运行器（仅开发验证需要） |

## 📁 目录结构

```text
ai-reference-gallery/
├── index.html           # 网站入口
├── app.js               # 姿势 / 服装切换、筛选与预览交互
├── i18n.js              # 中 / 英 / 日界面文案
├── style.css            # 响应式样式
├── catalog.js           # 姿势索引
├── costume-catalog.js   # 服装索引
├── img/                 # 唯一素材根目录（7,099 个图片文件）
│   ├── pose/            # 姿势：按 4 个系列分类
│   │   ├── solo-standard/
│   │   ├── solo-expressive/
│   │   ├── solo-upper-body/
│   │   └── duo/
│   │       ├── original/  # 每个系列均有 PNG 原图
│   │       └── thumbs/    # 每个系列均有 JPG 缩略图
│   └── costume/         # 服装：按 8 个品类分类
│       ├── spring/      # 春
│       ├── summer/      # 夏
│       ├── autumn/      # 秋
│       ├── winter/      # 冬
│       ├── lingerie/   # 内衣
│       ├── party/      # 派对
│       ├── swimwear/   # 泳装
│       └── sexy/       # 性感风格
│           ├── original/  # 每个品类均有 PNG 原图
│           ├── preview/   # 每个品类均有 WebP 预览图
│           └── thumbs/    # 每个品类均有 WebP 缩略图
├── scripts/             # 素材导入、目录整理及浏览器测试
├── test_i18n.cjs        # 图库索引、离线和多语言测试
├── ASSETS.md            # 素材版权和来源
├── CONTRIBUTING.md      # 贡献指南
└── LICENSE              # 仅代码的 MIT 许可证
```

## 🛠️ 自定义素材库

姿势索引由 `catalog.js` 以 `window.POSE_GALLERY_CATALOG` 暴露，服装索引由 `costume-catalog.js` 以 `window.COSTUME_GALLERY_CATALOG` 暴露。两者的数据结构不同，应分别按实际字段生成。

姿势条目示例：

```js
window.POSE_GALLERY_CATALOG = [
  {
    id: "EXAMPLE001",
    pose_key: "my-series|P001",
    pose_number: "P001",
    series: "My series",
    category: "Standing",
    pose_name: "Relaxed standing",
    angle: "Front",
    thumbnail: "img/pose/solo-standard/thumbs/example.jpg",
    original: "img/pose/solo-standard/original/example.png"
  }
];
```

服装条目包含 `id`、`category`、`keywords`、`thumbnail`、`preview`、`original` 等字段。服装图片使用 `img/costume/{category}/{original|preview|thumbs}/`，姿势图片使用 `img/pose/{series}/{original|thumbs}/`。使用自有素材时，确保索引路径对应实际文件，并遵守素材授权条款。

## ✅ 开发验证

Node.js **不是运行网站的依赖**，只在执行可选测试时使用：

```bash
node --test test_i18n.cjs
node --check app.js
node --check i18n.js
node --check catalog.js
node --check costume-catalog.js
node --check scripts/import-costumes.cjs
node scripts/browser-smoke.cjs # 可选：需要本机 Chrome/Edge 和 Node.js 22+
```

自动化测试覆盖离线加载、姿势和服装索引、目录结构、素材文件存在性、多语言文本及图库切换。浏览器烟雾测试会实际验证分类、搜索、预览和下载链接。需要重新导入授权服装素材时可运行 `node scripts/import-costumes.cjs`，图片将直接写入新的 `img/costume/` 分类目录。

## ☁️ GitHub 开源与部署说明

- **完整仓库**：所有图片都在 `img/pose/` 与 `img/costume/` 下，**受 Git 版本管理**。克隆完整仓库后，即可离线浏览，不依赖第三方图片服务或 Releases 下载包。
- **资源体积**：图片约 **2.06 GiB**，全量克隆耗时及硬盘占用较高。不要将仓库按普通轻量源码库衡量。
- **GitHub 首次推送**：GitHub 单次 push 有 2 GiB 限制，上传时应先推送源码，再把图片按分类分批提交、分批推送；**一次推送所有本地提交仍然可能超限**。
- **在线演示限制**：GitHub Pages 发布站点大小限制为 1 GB，不能直接拿这个完整图片仓库作为 Pages 站点部署。仓库用于完整下载与离线使用，在线演示可另选合适的托管方案。
- **发布前检查**：确认图片授权包含 GitHub 公开再分发及原图下载，检查敏感文件并完成浏览器验收。

## 🗺️ 下一步

- [x] 完成姿势 / 服装两类图库的切换与筛选逻辑
- [x] 补齐服装索引对应的本地文件并校验路径
- [x] 增加服装图库基础自动化测试
- [ ] 在真实浏览器中完成服装预览、下载、移动端适配等验收
- [x] 保持图片与源码同仓库，克隆后完整离线使用
- [ ] 增加适合 GitHub 首页的功能截图

## 📄 版权、授权与致谢

源码使用 [MIT License](LICENSE)；**MIT 许可证不自动适用于图片、缩略图及来源衍生的素材索引**。公开仓库前须核实素材授权是否包含 GitHub 公开再分发、用户下载和后续复用等范围。

参考素材来源：
- [POSE-DB-01 — 姿势素材原站](https://ai-pose-gallery.pages.dev/)
- [AI Costume Gallery — 服装素材原站](https://ai-costume-gallery.pages.dev/)

详细说明见 [ASSETS.md](ASSETS.md)。本项目为独立的浏览器实现，**不代表上述原站官方项目**。欢迎通过 Issue / Pull Request 提出改进建议，贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
