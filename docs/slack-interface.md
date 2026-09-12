# Slack 接口说明

这份文档描述当前后端为 Slack 预留的接口。Slack 是正式交互界面；邮箱、Agent 和审批逻辑都在后端服务中，Slack 适配层只负责身份、渲染和动作路由。

## 启动

先启动 API：

```bash
npm run dev
```

再启动 Slack Socket Mode 适配器：

```bash
npm run slack
```

环境变量：

```dotenv
AGENT_API_URL=http://localhost:8787
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
```

如果没有 Slack 凭据，适配器会自动进入离线 mock 模式。Slack 适配器通过
`HttpAgentApi` 调用 `AGENT_API_URL`，因此可以把 API 和 Slack 进程分别部署。

## Slack 命令

当前注册一个 Slash Command：

```text
/whenagent help
/whenagent profile
/whenagent scan
/whenagent inbox
/whenagent link <code>
```

| 命令 | 行为 |
| --- | --- |
| `profile` | 打开 Slack Modal，收集用户资料 |
| `scan` | 扫描未读邮件，并在当前会话发送机会卡片 |
| `inbox` | 查看待处理机会；当前也会触发一次扫描 |
| `link` | 预留邮箱设置页与 Slack 用户的绑定流程；当前只回显绑定码 |
| `help` | 显示命令帮助 |

## Slack 交互回调

机会卡片中的按钮使用以下 `action_id`：

| action_id | 行为 | 后端调用 |
| --- | --- | --- |
| `opportunity_review` | 准备报名表并打开 Review Modal | `prepare-form` |
| `opportunity_reject` | 忽略机会 | `approve`，decision=`reject` |
| `opportunity_review_submit` | 保存编辑后的草稿，批准并提交 | `draft` → `approve` → `submit` |
| `profile_submit` | 保存 Slack Modal 中的用户资料 | `POST /v1/profile` |

Review Modal 允许用户编辑 Agent 生成的正文或表单字段。点击批准后，Slack
适配器先保存草稿，再执行审批和提交。Slack 用户 ID 会作为 `userId` 传给
后端；当前没有绑定记录时使用 `demo-user` 作为本地演示身份。

## HTTP API 合同

### 用户资料

```http
GET /v1/profile?userId=U123
```

```http
POST /v1/profile
Content-Type: application/json

{
  "userId": "U123",
  "name": "张三",
  "school": "HKUST",
  "program": "Computer Science",
  "interests": ["AI", "Agents"],
  "skills": ["TypeScript"],
  "projects": ["mail agent"],
  "links": ["https://github.com/example"],
  "bio": "..."
}
```

### 扫描和机会

```http
POST /v1/scan
Content-Type: application/json

{ "userId": "U123" }
```

返回机会数组。每条机会包含：

```json
{
  "id": "uuid",
  "title": "HKUST AI Hackathon — Registration closes tonight",
  "sender": "events@example.com",
  "summary": "...",
  "category": "opportunity",
  "priority": "high",
  "deadline": "tonight",
  "fitScore": 0.91,
  "fitReasons": ["Matches profile: AI"],
  "sourceUrl": "https://example.com/form",
  "nextAction": "complete_registration",
  "status": "QUALIFIED"
}
```

```http
GET /v1/opportunities/:id
```

### 准备、编辑、审批和提交

```http
POST /v1/opportunities/:id/prepare-form
Content-Type: application/json

{ "userId": "U123" }
```

```http
PATCH /v1/opportunities/:id/draft
Content-Type: application/json

{
  "userId": "U123",
  "draft": "我希望参加这次活动，因为……",
  "fields": {
    "name": "张三",
    "school": "HKUST"
  }
}
```

```http
POST /v1/opportunities/:id/approve
Content-Type: application/json

{ "userId": "U123", "decision": "approve" }
```

`POST /v1/opportunities/:id/decision` 是同一决策接口的兼容别名。

```http
POST /v1/opportunities/:id/submit
Content-Type: application/json

{ "userId": "U123" }
```

提交前机会必须处于 `WAITING_APPROVAL`。成功后状态变为 `SENT` 或
`SUBMITTED`，并返回模拟 SMTP message ID。当前默认是 MockMailbox；真实
IMAP/SMTP 适配器替换后，Slack 接口不需要改变。

### 反馈

```http
POST /v1/feedback/events
Content-Type: application/json

{
  "userId": "U123",
  "opportunityId": "uuid",
  "kind": "useful",
  "comment": "匹配准确"
}
```

反馈类型可以使用 `useful`、`not_useful`、`wrong_category`、`snooze`、
`reject` 或 `edit`。后续可据此生成用户偏好，但当前只负责记录事件。

## 邮箱连接配套 API

这些接口主要供本地 Web 控制台和后续 Slack 的账号绑定流程使用。邮箱密码
只提交给后端，不应该出现在 Slack 消息、日志或卡片中。

```http
POST /v1/accounts/test
Content-Type: application/json

{
  "imap": { "host": "imap.example.com", "port": 993, "secure": true, "user": "student@example.com", "password": "..." },
  "smtp": { "host": "smtp.example.com", "port": 465, "secure": true, "user": "student@example.com", "password": "..." }
}
```

验证通过后连接：

```http
POST /v1/accounts/connect
GET  /v1/accounts/status
GET  /v1/messages
GET  /v1/messages/:id
POST /v1/send
```

Slack 不需要知道这些协议细节，只需要调用 `scan`、`prepare-form`、
`approve` 和 `submit`。因此未来改成 OAuth 或增加其他邮箱服务时，Slack
卡片和命令可以保持不变。

## 状态流

```text
DISCOVERED
  → CLASSIFIED / QUALIFIED
  → WAITING_APPROVAL
  → SENT 或 SUBMITTED
```

用户拒绝后进入 `REJECTED`。Slack 不直接操作邮箱协议，只调用上述服务接口。

## 代码扩展点

- `src/slack/adapter.ts`：Slash Command、按钮和 Modal 回调；
- `src/slack/api-client.ts`：Slack 到后端的 HTTP 适配器；
- `src/slack/blocks.ts`：机会卡片和 Modal；
- `src/slack/types.ts`：Slack 与 Agent 之间的接口类型；
- `src/slack/index.ts`：对外导出 Slack 适配器；
- `src/services/forms.ts`：表单读取、准备和提交的 `FormAdapter` 预留。

未来接入 CopilotKit Channels 时，只需要替换 Slack Adapter，保留
`AgentApi` 和业务服务接口即可。
