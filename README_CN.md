<p align="center">
  <h1 align="center">Siege</h1>
  <p align="center">
    AI 驱动的智能开发工具
    <br />
    <a href="README.md">English</a>
    <br />
    <em>从设计到实现，一站式完成。</em>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue" />
  <img src="https://img.shields.io/badge/SQLite-local-green" />
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20GPT%20%7C%20GLM-purple" />
  <img src="https://img.shields.io/badge/i18n-中文%20%7C%20English-orange" />
</p>

---

## 为什么选择 Siege？

Siege 将 Claude Code / Codex 包装成一个**完整的开发生命周期管理器**，配合可视化 UI：

```
 计划  →  方案  →  排期  →  执行  →  审查  →  测试
  │        │       │        │        │       │
 描述     AI生成   甘特图   Claude   Diff视图  AI生成
 +标签   +编辑    时间线   Code/Codex +标注   +运行
```

- **持久化上下文** — 项目、计划、方案、执行日志全部存储在 SQLite。随时继续上次的工作。
- **结构化设计** — AI 先生成技术方案，审查通过后再写代码。支持对话式修改方案。
- **可视化任务排期** — AI 将工作拆解为有序任务，以甘特图展示。
- **GitHub PR 风格代码审查** — 查看 `git diff`，语法高亮、文件树导航、行内 AI 标注、一键修复。
- **AI 驱动测试** — 基于实际代码变更自动生成并运行测试用例。
- **多 AI 提供商** — Anthropic (Claude)、OpenAI (GPT)、GLM (智谱)。

---

## 截图

<table>
  <tr>
    <td><img src="docs/screenshots/zh/03-project-list.png" alt="项目列表" /><br /><em>项目列表 — Monolith 暗色主题</em></td>
    <td><img src="docs/screenshots/zh/10-plan-sidebar.png" alt="计划详情" /><br /><em>计划详情 — 侧边栏工作流导航</em></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/zh/05-scheme-detail.png" alt="技术方案" /><br /><em>AI 生成的技术方案</em></td>
    <td><img src="docs/screenshots/zh/09-schedule-gantt.png" alt="甘特图" /><br /><em>甘特图 + 自动执行时间轴</em></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/zh/07-code-review-diff.png" alt="代码审查" /><br /><em>代码审查 — Diff 视图 + Findings</em></td>
    <td><img src="docs/screenshots/zh/06-settings.png" alt="设置" /><br /><em>AI 服务配置</em></td>
  </tr>
</table>

## 核心流程

**1. 创建项目** — 选择本地仓库。AI 自动检测 `CLAUDE.md` 获取项目上下文。

**2. 创建计划** — 描述你想要构建的内容。支持文件夹整理、标签分类。

**3. 生成方案** — AI 分析代码，生成技术方案。支持编辑、审查、对话式修改。

**4. 生成排期** — AI 将方案拆解为可执行任务，以甘特图展示时间线。

**5. 执行** — 一键自动执行所有任务，每个任务使用精简 prompt 并传递上下文。

**6. 代码审查** — 按任务筛选 `git diff`，AI 审查结果按任务分组，支持一键修复。

**7. 测试** — 选择已完成任务，AI 基于实际代码变更生成测试用例。

## 功能特性

### AI 集成
- **多提供商**：Anthropic (Claude)、OpenAI (GPT)、GLM (智谱)
- **模型选择**：每个 AI 动作均可选择模型
- **代理支持**：自定义 API 基础 URL
- **Claude Code / Codex ACP**：Agent Client Protocol，无需 API Key
- **会话复用**：同一计划内后续 AI 调用复用会话

### 代码审查
- 带语法高亮的 **Git diff 查看器**
- **文件树侧边栏**，显示增删统计和发现计数
- **Findings 按任务分组**，折叠面板
- **一键"AI 修复"** — 直接将 AI 建议应用到文件

### 多来源导入
- **Markdown** / **Notion** / **Jira** / **Confluence** / **飞书**
- **GitHub Issues** / **GitLab Issues** / **MCP Server**

### 设计系统
- **Monolith** — 深色主题，色调分层
- **无边框规则** — 通过背景色差定义边界
- **Space Grotesk + Inter** 字体
- **侧边栏工作流导航**

## 快速开始

```bash
git clone https://github.com/Kotodian/siege.git
cd siege
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) — 引导页会带你完成配置。

### 前置条件

- **Node.js** 20+
- **Claude Code** (`claude` CLI) — 推荐，用于 ACP 引擎
- **GitHub CLI** (`gh`) — 可选，用于 PR 集成

## 部署

### 直接部署

```bash
npm run build
PORT=3000 npm start
```

### Docker

```bash
docker build -t siege .
docker run -d -p 3000:3000 -v siege-data:/app/data siege
```

### 数据

- 数据库：`./data/siege.db`（SQLite，首次运行自动创建）
- 设置 `DATA_DIR` 环境变量可更改数据目录

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| 数据库 | SQLite (Drizzle ORM + better-sqlite3) |
| 样式 | Tailwind CSS 4 |
| 设计 | Monolith 暗色主题 |
| AI SDK | Vercel AI SDK + Claude/Codex CLI |
| 国际化 | next-intl |
| 图表 | frappe-gantt |
| 测试 | Vitest |

## 开发

```bash
npm test              # 运行测试
npm run test:watch    # 监听模式
npm run build         # 构建
npx drizzle-kit generate  # Schema 变更后生成迁移
```

## 许可证

MIT
