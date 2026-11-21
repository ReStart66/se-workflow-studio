# 通用 SE Workflow 任务编排器原型

软件工程与项目实践课程课堂作业 2，第 11 组。

## 项目目标

验证一条通用、可定制的软件工程工作流：

```text
产品设计规格
→ PM Agent 任务分解
→ 编排器生成任务排期
→ 任务流程图、WBS 任务树与甘特图可视化
→ 模拟执行与日志
```

微信、小红书等具体产品仅作为测试案例，工作流本身通过 `prototype/workflow_rules.json` 扩展和定制。

## 原型功能

- 输入产品设计规格
- PM Agent 识别产品类型和功能域
- 自动生成开发任务
- 为任务分配角色、阶段、优先级、工时和依赖
- 任务流程图：开始 → 规划 → 设计 → 开发 → 测试 → 发布 → 结束
- WBS 任务分解树：主干 → 阶段 → 任务
- 任务明细表
- 编排器计算任务开始/结束日期
- 甘特图展示执行编排
- 模拟执行、取消和重置
- 执行日志和状态更新
- SQLite 持久化

## 运行原型

需要 Python 3.10 以上，无第三方 Python 依赖。

```powershell
cd "prototype"
python server.py
```

打开：

```text
http://127.0.0.1:8000
```

也可以回到仓库根目录双击：

```text
启动原型.bat
```

## 目录结构

```text
prototype/
  server.py            HTTP API、PM Agent 规则、编排器和 SQLite
  workflow_rules.json  通用工作流与产品示例配置
  static/              前端页面、样式和交互
  data/                SQLite 数据库，运行时自动生成
  README.md
  run.ps1
  run.bat
docs 根目录下的设计规格文档
```

## 示例设计规格

```text
我要做一个类似小红书的内容社区，支持图文笔记、视频、搜索推荐、关注互动和电商。
```

```text
我要做一个类似微信的即时通讯产品，支持聊天、通讯录、朋友圈、支付和小程序。
```

## DeepSeek

界面中 PM Agent 使用 `deepseek-reasoner`，其他角色使用 `deepseek-chat`。

当前课堂原型使用 Mock 模型执行，不调用真实 DeepSeek API，不需要 API Key，不依赖外部网络，演示结果稳定可重复。
