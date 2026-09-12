import { App, LogLevel, type BlockAction, type ViewSubmitAction } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { inboxBlocks, opportunityCard, profileView, reviewView } from "./blocks.js";
import { MockAgentApi } from "./api-client.js";
import type { AgentApi, Opportunity, SlackAdapterOptions, UserProfile } from "./types.js";

const ok = (message: string) => [{ type: "section" as const, text: { type: "mrkdwn" as const, text: message } }];
const userIdOf = (body: { user?: { id?: string } }, fallback: string) => body.user?.id || fallback;
const valueOf = (values: Record<string, any>, block: string) => values?.[block]?.value?.value?.trim() || "";
const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

function parseProfile(values: Record<string, any>): UserProfile {
  const programYear = valueOf(values, "program").split("/").map((item: string) => item.trim());
  const links: string[] = valueOf(values, "links").split(/\s+/).filter(Boolean);
  return {
    name: valueOf(values, "name"), school: valueOf(values, "school"),
    program: programYear[0] || undefined, year: programYear[1] || undefined,
    interests: csv(valueOf(values, "interests")), skills: csv(valueOf(values, "skills")),
    projects: valueOf(values, "projects"), github: links.find((link) => /github\.com/i.test(link)),
    portfolio: links.find((link) => !/github\.com/i.test(link)), bio: valueOf(values, "bio"),
  };
}

function errorBlocks(error: unknown): KnownBlock[] {
  const message = error instanceof Error ? error.message : String(error);
  return [{ type: "section", text: { type: "mrkdwn", text: `⚠️ 操作失败：${message}` } }];
}

export function createSlackApp(options: SlackAdapterOptions): App {
  // Socket Mode authenticates the WebSocket with the app-level token. A
  // signing secret is only needed by Bolt's HTTP receiver, so do not force
  // it for local Socket Mode connections.
  const mock = options.mock || !options.botToken || !options.appToken;
  const api: AgentApi = options.api || new MockAgentApi();
  // Bolt calls auth.test while constructing an app with a token. Use its
  // authorize hook in mock mode so local tests never contact Slack.
  const app = mock
    ? new App({
      signingSecret: options.signingSecret || "mock-signing-secret",
      authorize: async () => ({ botToken: "xoxb-mock", botId: "BMOCK", teamId: "TMOCK" }),
      logLevel: LogLevel.ERROR,
    })
    : new App({
      token: options.botToken,
      ...(options.signingSecret ? { signingSecret: options.signingSecret } : {}),
      appToken: options.appToken,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });
  const fallbackUser = options.defaultUserId || "demo-user";

  app.command("/whenagent", async ({ command, ack, say, client }) => {
    await ack();
    const userId = command.user_id || fallbackUser;
    const [subcommand, ...args] = command.text.trim().split(/\s+/).filter(Boolean);
    try {
      if (!subcommand || subcommand === "help") {
        await say({ text: "WhenAgent 命令：`profile` 设置资料，`scan` 扫描邮件，`inbox` 查看机会。", blocks: ok("*WhenAgent*\n`profile` 设置资料\n`scan` 扫描邮件\n`inbox` 查看待处理机会") });
      } else if (subcommand === "profile") {
        await client.views.open({ trigger_id: command.trigger_id, view: profileView(await api.getProfile(userId)) });
      } else if (subcommand === "scan") {
        const opportunities = await api.scan(userId);
        await say({ text: opportunities.length ? `发现 ${opportunities.length} 个需要关注的机会。` : "没有发现新的机会。", blocks: inboxBlocks(opportunities) });
      } else if (subcommand === "inbox") {
        const opportunities = await api.scan(userId);
        await say({ text: "待处理机会", blocks: inboxBlocks(opportunities) });
      } else if (subcommand === "link") {
        await say({ text: `绑定码 ${args[0] || "缺少绑定码"}（Web 设置页生成）` });
      } else {
        await say({ text: `未知命令：${subcommand}。输入 "/whenagent help" 查看用法。` });
      }
    } catch (error) { await say({ blocks: errorBlocks(error), text: "操作失败" }); }
  });

  app.action("opportunity_review", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0] as { value?: string } | undefined;
    const opportunityId = action?.value;
    if (!opportunityId || !(body as BlockAction).trigger_id) return;
    const userId = userIdOf(body as BlockAction, fallbackUser);
    try {
      const opportunity = await api.prepareForm(opportunityId, userId);
      const source = body as BlockAction;
      await client.views.open({ trigger_id: source.trigger_id, view: reviewView({ ...opportunity, draft: opportunity.draft }) });
    } catch (error) {
      if ("respond" in body && typeof (body as any).respond === "function") await (body as any).respond({ response_type: "ephemeral", text: error instanceof Error ? error.message : String(error) });
    }
  });

  app.action("opportunity_reject", async ({ ack, body, respond }) => {
    await ack();
    const action = (body as any).actions?.[0] as { value?: string } | undefined;
    const opportunityId = action?.value;
    if (!opportunityId) return;
    try {
      await api.decide(opportunityId, userIdOf(body as BlockAction, fallbackUser), "reject");
      await respond({ replace_original: false, response_type: "ephemeral", text: "已忽略这条机会。" });
    } catch (error) { await respond({ response_type: "ephemeral", text: error instanceof Error ? error.message : String(error) }); }
  });

  app.view("profile_submit", async ({ ack, body, view, client }) => {
    await ack();
    const userId = userIdOf(body as ViewSubmitAction, fallbackUser);
    try {
      await api.saveProfile(userId, parseProfile(view.state.values as Record<string, any>));
      await client.chat.postMessage({ channel: userId, text: "✅ WhenAgent 已保存你的资料。现在可以运行 `/whenagent scan`。" });
    } catch (error) { await client.chat.postMessage({ channel: userId, text: `⚠️ 保存资料失败：${error instanceof Error ? error.message : String(error)}` }); }
  });

  app.view("opportunity_review_submit", async ({ ack, body, view, client }) => {
    await ack();
    const userId = userIdOf(body as ViewSubmitAction, fallbackUser);
    let metadata: { opportunityId?: string; version?: string } = {};
    try { metadata = JSON.parse(view.private_metadata || "{}"); } catch { /* malformed metadata cannot authorize a submission */ }
    if (!metadata.opportunityId) return;
    try {
      const editedBody = valueOf(view.state.values as Record<string, any>, "draft_body");
      if (editedBody && api.updateDraft) {
        await api.updateDraft(metadata.opportunityId, userId, { body: editedBody, version: metadata.version });
      }
      await api.decide(metadata.opportunityId, userId, "approve");
      const result = await api.submit(metadata.opportunityId, userId, metadata.version);
      await client.chat.postMessage({ channel: userId, text: `✅ 已完成：${result.title}` });
    } catch (error) { await client.chat.postMessage({ channel: userId, text: `⚠️ 提交失败：${error instanceof Error ? error.message : String(error)}` }); }
  });

  return app;
}

export async function startSlackApp(options: SlackAdapterOptions): Promise<App> {
  const app = createSlackApp(options);
  if (options.mock || !options.botToken || !options.appToken) {
    console.log("Slack adapter created in mock mode; set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to connect via Socket Mode.");
    return app;
  }
  await app.start();
  console.log("⚡ WhenAgent Slack adapter is running in Socket Mode");
  return app;
}
