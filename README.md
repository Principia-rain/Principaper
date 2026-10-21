# 论文站

一个依托 **GitHub Pages** 的个人论文网站：**站主可以上传论文，访客可以在线阅读**。
纯静态、无后端、无数据库、无统计脚本 —— 仓库本身就是全部。

## 功能一览

| 角色 | 能做什么 |
|---|---|
| 访客 | 浏览/搜索/按标签筛选论文列表；在线阅读 Markdown（含 **LaTeX 公式**、代码高亮、表格、图片）与 **PDF**；一键跳转论文配套的**代码仓库**；深浅色主题；Ctrl+P 打印/存 PDF |
| 站主 | 网页内**直接上传/删除**论文（GitHub 管理面板）；也可用 GitHub 网页上传或 git push；PDF 上传时可顺手填标题/摘要/标签/代码链接 |

Markdown 渲染由 [marked](https://github.com/markedjs/marked) 完成，公式由 [KaTeX](https://github.com/KaTeX/KaTeX) 渲染，代码高亮用 [highlight.js](https://github.com/highlightjs/highlight.js) —— 均来自公共 CDN，向这些开源项目致谢。

---

## 一、从零部署到 GitHub（约 5 分钟）

> 前置：一个 [GitHub 账号](https://github.com/signup)。

1. **新建仓库**：GitHub 右上角 `+` → *New repository*。
   - 仓库名随意（例如 `papers`）；
   - 可见性必须选 **Public**（私有仓库访客读不到）；
   - 不要勾选自动生成 README（我们自带）。

2. **上传本文件夹里的全部文件**（保持目录结构）：
   - 网页操作：仓库页 *uploading an existing file*，把 `paper-site` 里的**所有文件和文件夹**拖进去 → Commit；
   - 或命令行：
     ```bash
     git init
     git add .
     git commit -m "论文站初始版本"
     git branch -M main
     git remote add origin https://github.com/你的用户名/仓库名.git
     git push -u origin main
     ```

3. **开启 Pages**：仓库 *Settings* → 左侧 *Pages* →
   *Build and deployment* → Source 选 **Deploy from a branch** → Branch 选 **main / /(root)** → Save。

4. 等 1–2 分钟，访问 `https://你的用户名.github.io/仓库名/` 就能看到你的论文站。
   站点会**从网址自动识别**你的用户名和仓库名，`config.js` 什么都不用改。

> 改站名：编辑 `config.js` 里的 `siteName`；不改则自动用仓库名。

---

## 二、上传论文（三种方式，任选）

| 方式 | 操作 | 适合 |
|---|---|---|
| **① 站内管理面板**（推荐） | 打开网站 → 右上角「站主登录」→ 粘贴 GitHub Token → 拖入文件上传 | 日常写作，手机也能用 |
| ② GitHub 网页上传 | 仓库 → `papers/` 目录 → *Add file* → *Upload files* | 偶尔传一下 |
| ③ git push | 把 `.md`/`.pdf` 放进 `papers/` 目录提交推送 | 用命令行的你 |

无论哪种方式，上传后约 **1 分钟**内全站可见（GitHub Pages 构建时间）。

### 论文写作格式

Markdown 论文开头可写 front matter 元信息（完整模板见 `papers/示例论文.md`）：

```markdown
---
title: 论文标题
author: 你的名字
date: 2026-10-21
tags: [标签1, 标签2]
abstract: 一两句摘要，显示在首页卡片上。
code: https://github.com/某人/某仓库, https://github.com/某人/另一仓库
---

正文从这里开始……
```

- `date` 是首页排序依据（新的在前）；
- `code` 是**代码仓库链接**，会变成首页卡片和阅读页上的「💻 代码仓库」按钮；
- 图片与论文一起上传到 `papers/`（可用子文件夹），正文里用相对路径引用：
  `![图1](我的论文-图/fig1.png)`；
- **PDF 论文**直接上传即可；想让首页卡片显示标题/摘要，再传一个同名 JSON
  （`my-paper.pdf` 配 `my-paper.pdf.json`），格式见 `papers/示例论文.md` §6；
- 以 `_` 或 `.` 开头的文件不会被展示（可放草稿）。

---

## 三、站主登录（GitHub Token）

管理面板需要一个 **Fine-grained Personal Access Token** 来替你在仓库里创建/删除文件：

1. GitHub → 头像 → *Settings* → 最底部 *Developer settings*；
2. *Personal access tokens → Fine-grained tokens → Generate new token*；
3. **Repository access** 选 *Only select repositories*，只勾选本论文仓库；
4. **Permissions → Repository permissions → Contents: Read and write**
   （Metadata 会自动变为 Read-only，不用管）；
5. 生成后复制（`github_pat_` 开头），粘贴进网站的登录框即可。

安全设计：

- Token **只保存在你自己的浏览器**里（可选“记住”），本站是纯静态页面、没有后端，
  Token 只会发送给 `api.github.com`；
- 建议只授予**这一个仓库**的 Contents 权限，并设置有效期；
- 怀疑泄露时到 *Developer settings* 里一键删除即可；网页上也可随时「退出登录」。

---

## 四、访客侧说明

- 列表数据带 30 分钟本地缓存（`config.js` 的 `cacheMinutes` 可调），
  列表页 ⟳ 按钮可强制刷新绕过缓存；
- 阅读页的外链一律新标签打开；站内相对链接/图片自动指向仓库原文件；
- 手机浏览器若不支持内嵌 PDF，会给出「新标签页打开」的备用链接；
- **打印/导出 PDF**：在论文阅读页按 Ctrl+P，导航/按钮会自动隐藏。

---

## 五、本地预览

```bash
cd paper-site
python tools/build_index.py      # 扫描 papers/ 生成 index.json（本地模式用）
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

本地模式下站点读取 `papers/index.json`（部署到 GitHub 后则不需要它，
默认走 GitHub API；`useIndexJson` 默认为 false）。

> 注意：直接双击 index.html 用 `file://` 打开是看不到列表的（浏览器限制 fetch），
> 请务必走上面的本地服务器。

---

## 六、常见问题（FAQ）

| 现象 | 原因与处理 |
|---|---|
| 列表报「找不到仓库」 | 仓库名/用户名识别错了（自定义域名时需在 `config.js` 手工填 `owner`/`repo`），或仓库不是 Public |
| 报 403 限流 | GitHub API 匿名限额 60 次/小时/IP（校园网共享出口容易触发）。稍等再试；或运行 `python tools/build_index.py` 并把 `config.js` 的 `useIndexJson` 设为 true（之后每次增删论文要重跑该脚本） |
| 刚上传的论文没出现 | Pages 构建 + 缓存延迟，等 1–2 分钟；或点列表 ⟳ 强刷 |
| 公式没渲染 | 确认定界符是 `$...$` / `$$...$$`（或 `\(..\)`、`\[..\]`）；代码块里的 `$` 会被刻意保持原样 |
| 公式里的下划线变斜体 | 不会——本站在 Markdown 解析前对公式做了保护，放心写 LaTeX |
| 想改配色 | 编辑 `assets/style.css` 顶部的 CSS 变量即可 |
| 想绑自定义域名 | 仓库加 CNAME 文件 + DNS 解析，并在 `config.js` 填 `owner`/`repo` |

---

## 七、目录结构

```
paper-site/
├── index.html            页面骨架
├── config.js             站主配置（站名、缓存、进阶选项；一般不用改）
├── about.md              「关于」页内容
├── .nojekyll             让 Pages 跳过 Jekyll、原样发布
├── assets/
│   ├── style.css         样式（浅/深双主题）
│   ├── core.js           纯逻辑（front matter 解析、公式保护、条目合并…）
│   └── app.js            页面逻辑（列表/阅读/路由/管理面板）
├── papers/               ← 论文都放这里
│   ├── 示例论文.md         写作模板（可删）
│   └── _如何上传论文.md    说明（下划线开头，不展示）
└── tools/
    ├── build_index.py    可选：生成 index.json（应对 API 限流）
    └── test_core.cjs     单元测试（node tools/test_core.cjs）
```

## 许可

站点代码可自由使用与修改。论文内容版权归各作者所有。
