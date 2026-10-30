# 第三方声明

## ai-reference-gallery（代码，MIT）

本项目由 [ai-reference-gallery](https://github.com/ZDC494225094/ai-reference-gallery) 改造而来，沿用了其中的参考板拼接逻辑、提示词文案和素材目录格式。

```
MIT License

Copyright (c) 2026 ai-pose-gallery contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 素材图片（不在任何开源许可内）

原项目的姿势素材来自 [AI Pose Gallery](https://ai-pose-gallery.pages.dev/)，服装素材来自 [AI Costume Gallery](https://ai-costume-gallery.pages.dev/)，原作者ギア（@giaaibusi）。原项目的 ASSETS.md 明确说明：MIT 许可不覆盖图片、缩略图和衍生索引。本仓库不包含这些图片；导入脚本只读取你本地的副本。**商用前请取得权利人的书面授权，或替换为你自己拥有版权的素材。**

`docs/screenshots/` 中的截图包含上述示例素材，公开发布本仓库前请一并确认授权或替换截图。

## 字体

- 思源黑体 Noto Sans SC（Google、Adobe），SIL Open Font License 1.1，许可证全文见 `public/assets/fonts/noto-sans-sc/LICENSE`。网页分包文件取自 npm 包 `@fontsource/noto-sans-sc` 5.3.1。

## 运行依赖

| 包 | 许可证 |
|---|---|
| express | MIT |
| better-sqlite3（内含 SQLite，公有领域） | MIT |
| sharp | Apache-2.0 |
| libvips（随 sharp 预编译包分发） | LGPL-3.0-or-later |
| multer | MIT |
| qrcode | MIT |
| nodemailer | MIT-0 |

完整许可证文本见 `node_modules/<包名>/LICENSE`。
