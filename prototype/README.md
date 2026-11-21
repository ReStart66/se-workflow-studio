# 通用 SE Workflow 原型

课堂作业 2 原型：**输入产品设计规格，由 PM Agent 生成开发任务分解，编排器生成执行排期并可视化。**

项目目标不是写死某一个产品，而是验证一条通用、可定制的软件工程工作流。微信、小红书等只是测试案例。

## 功能

- 输入产品设计规格
- PM Agent 分析功能域
- 自动生成开发任务
- 为任务分配角色、阶段、优先级、工时和依赖
- 编排器计算任务开始/结束时间
- 甘特图展示任务排期
- WBS 任务分解树（主干 → 阶段 → 任务）
- 任务明细表
- 任务详情检查器
- 模拟执行任务编排
- 执行日志和状态更新
- SQLite 持久化
- 支持微信、小红书和通用产品三类示例

## 运行

需要 Python 3.10 以上，不需要第三方 Python 包。

```powershell
cd "C:\Users\99323\Desktop\软件工程与项目实践\week9-任务编排器\prototype"
python server.py
```

打开：

```text
http://127.0.0.1:8000
```

也可以使用上级目录的：

```text
启动原型.bat
```

## 使用方式

1. 在“设计规格”页输入产品描述。
2. 点击“生成任务分解”。
3. 查看 PM Agent 生成的功能域、任务数、工时和编排周期。
4. 进入“任务分解”查看任务、角色、依赖、工时和优先级。
5. 进入“执行编排”查看甘特图。
6. 点击“模拟执行”，观察任务状态和日志变化。
7. 使用“取消”和“重置编排”恢复演示状态。

## 示例

### 小红书

```text
我要做一个类似小红书的内容社区，支持图文笔记、视频、搜索推荐、关注互动和电商。
```

### 微信

```text
我要做一个类似微信的即时通讯产品，支持聊天、通讯录、朋友圈、支付和小程序。
```

### 通用产品

```text
我要做一个企业内部协作系统，支持用户权限、核心业务、搜索和通知。
```

## 任务生成方式

`workflow_rules.json` 保存通用工作流模板和产品示例配置。

PM Agent 使用规则匹配：

- 微信/即时通讯
- 小红书/内容社区
- 通用产品

生成的任务包括：

- 需求分析
- 技术方案与架构设计
- 数据模型与接口设计
- 交互流程与页面规划
- 各功能域后端服务
- 各功能域前端体验
- 权限、安全与审计
- 集成测试与验收测试
- 部署、监控与发布
- 需求验收与发布确认

编排器根据任务依赖计算开始日和结束日，形成甘特图。

## 自定义工作流

可以编辑：

```text
prototype/workflow_rules.json
```

修改产品关键词、功能域和默认模型配置，即可生成不同的任务分解。

## DeepSeek 与 API

当前使用 **Mock PM Agent**，不调用真实 DeepSeek API。

界面中的模型名称：

- `deepseek-reasoner`：PM Agent 任务分解
- `deepseek-chat`：其他角色模型配置

目前不需要 API Key，也不依赖网络，课堂演示结果固定、可重复。

如果要接入真实 DeepSeek API，后续需要增加：

- API Key 配置
- DeepSeek API 客户端
- 超时和重试
- 结构化任务输出解析
- 失败回退

课堂演示建议继续使用 Mock 模式。

## 目录结构

```text
prototype/
  server.py             HTTP API、PM Agent 规则、编排器和 SQLite
  workflow_rules.json   通用工作流和产品示例配置
  static/
    index.html          设计规格、任务分解、执行编排三个页面
    styles.css          页面样式
    app.js              任务生成、甘特图和交互逻辑
  data/
    workflow.db         自动生成的 SQLite 数据库
  run.ps1
  run.bat
  README.md
```

## API

```text
GET  /api/health
GET  /api/workflows
POST /api/workflows/generate
GET  /api/workflows/{id}
POST /api/workflows/{id}/run
POST /api/workflows/{id}/cancel
POST /api/workflows/{id}/reset
GET  /api/rules
```

## 设计对应关系

```text
设计规格
  → PM Agent 任务分解
  → 任务依赖和角色分配
  → 编排器排期
  → 甘特图可视化
  → 模拟执行与日志
```


