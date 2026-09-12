# 大模型功能与调用方式

## 配置

本地 key 放在项目根目录的 `.env`，这个文件已被 `.gitignore` 忽略，不会进入
GitHub。仓库只保留 `.env.example` 中的变量名。

当前支持两种 provider：

1. `OPENROUTER_API_KEY`：优先使用，默认访问 `https://openrouter.ai/api/v1`；
2. `DEEPSEEK_API_KEY`：没有 OpenRouter key 时使用 DeepSeek 原生 API；
3. 两者都没有时，自动使用本地规则分类，不会发起模型请求。

相关环境变量：

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=deepseek/deepseek-chat
OPENROUTER_SITE_URL=http://localhost:8787
LLM_ENABLED=true

# 可选的直连 DeepSeek 配置
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

查看当前实际 provider，不会返回 key：

```http
GET /v1/llm/status
```

返回示例：

```json
{
  "configured": true,
  "provider": "openrouter",
  "model": "deepseek/deepseek-chat"
}
```

本地演示默认将 `LLM_ENABLED` 设为 `false`，这样没有网络或额度时扫描仍会
立即使用规则分类。要让扫描真的调用已配置的 OpenRouter key，把本机 `.env`
中的它改为 `true`，重启 API 后再点击扫描。

## 当前已实现的大模型功能

### 邮件分类和机会判断

调用：

```http
POST /v1/scan
Content-Type: application/json

{ "userId": "demo-user" }
```

后端会读取未读邮件，并把以下内容发送给模型：

- 邮件主题；
- 邮件正文；
- 用户资料中的学校、兴趣、技能和项目经历。

模型被要求返回结构化 JSON：

```json
{
  "category": "opportunity",
  "priority": "high",
  "fitScore": 0.91,
  "deadline": "tonight 23:59",
  "nextAction": "complete_registration",
  "evidence": ["报名截止今晚" ]
}
```

结果会保存为 Opportunity，并由 Web 控制台或 Slack 卡片展示。

## 调用链

```text
Web 控制台“扫描邮件”
        ↓
POST /v1/scan
        ↓
IMAP 读取未读邮件
        ↓
OpenRouter / DeepSeek / 本地规则
        ↓
Opportunity JSON
        ↓
Web 控制台和 Slack 展示
```

Slack 的 `/whenagent scan` 调用的是同一个 `/v1/scan`，不会产生另一套模型逻辑。

## 目前没有调用大模型的地方

- 保存用户资料：只是写入 profile；
- IMAP/SMTP 登录：只是连接协议；
- 查看邮件：返回邮件内容；
- 审批和发送：执行用户已确认的动作；
- 当前报名表预填：使用用户资料的确定性映射。

后续可以把报名动机、回复草稿和表单答案接入同一个 OpenAI-compatible
调用，但目前尚未把这些动作伪装成已经完成的模型功能。

## 安全约定

- key 只放本机 `.env`；
- 前端、Slack 消息和 API 返回值不包含 key；
- GitHub 只提交 `.env.example`；
- 如果 key 曾经被提交、打印到日志或发送到第三方，应立即在 provider 控制台撤销并重新生成。
