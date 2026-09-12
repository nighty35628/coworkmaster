/**
 * Tools that put the Opportunity backend inside the thread.
 *
 * Two rules hold this file together.
 *
 * 1. IDENTITY COMES FROM THE CHANNEL, NEVER FROM THE MODEL.
 *    No tool below takes a `userId` parameter. `identifyUser: "platform"` in
 *    channel.tsx makes `ctx.user.id` the canonical platform user, and every
 *    handler reads identity from there. A userId the model can type is a
 *    userId the model can point at somebody else.
 *
 * 2. THE BACKEND'S CLASSIFICATION IS NOT SURFACED.
 *    The backend scores fit with keyword matching (src/services/agent.ts:
 *    `fitScore = 0.55 + matches * 0.12`). Handing that number to the model
 *    anchors it on a fake score instead of the thread, the profile, and the
 *    email body. So `scan_inbox` strips those fields and `read_message` returns
 *    the raw mail: the reasoning that reaches the user is the agent's own.
 *
 * The backend keeps its DeepSeek call. It never fires unless DEEPSEEK_API_KEY
 * is set in the backend's environment, and nothing here sets it.
 */
import {
  defineChannelTool,
  Message,
  Header,
  Section,
  Markdown,
  Context,
  Actions,
  Button,
} from "@copilotkit/channels";
import { z } from "zod";
import { backend, userIdOf } from "./backend";

interface BackendProfile {
  userId: string;
  name: string;
  school?: string;
  program?: string;
  interests: string[];
  skills: string[];
  projects: string[];
  links: string[];
  bio?: string;
}

interface BackendOpportunity {
  id: string;
  title: string;
  sender?: string;
  deadline?: string;
  sourceUrl?: string;
  messageId: string;
  status?: string;
}

interface BackendMessage {
  id: string;
  from: string;
  subject: string;
  text: string;
  url?: string;
}

/**
 * Rung 2 of the Context Ladder, from the user's own data rather than the
 * thread. Without this the agent answers every "should I join this?" with the
 * same generic advice it would give anybody.
 */
export const getProfile = defineChannelTool({
  name: "get_profile",
  description:
    "读取当前用户在后端的资料:学校、专业、兴趣、技能、项目、个人简介。判断一个机会是否适合这个人之前必须先调用它。不要用你自己的假设代替真实资料。",
  parameters: z.object({}),
  async handler(_args, ctx) {
    const userId = userIdOf(ctx);
    const profile = await backend<BackendProfile | null>(
      `/v1/profile?userId=${encodeURIComponent(userId)}`,
    );

    if (!profile) {
      // A null profile is a first-run state, not an error. Say so in a way the
      // model turns into an onboarding ask rather than an invented biography.
      return "这个用户还没有填写资料(后端返回空)。请他去 App Home 或运行 `/whenagent profile` 建立资料,建好之后你才能判断机会是否匹配。绝对不要编造他的背景、技能或兴趣。";
    }

    return profile;
  },
});

export const scanInbox = defineChannelTool({
  name: "scan_inbox",
  description:
    "扫描用户邮箱里未读的机会邮件,返回待判断的机会线索。只返回原始线索,不含匹配度评分——值不值得参加由你结合 get_profile 和 read_message 自己判断。",
  parameters: z.object({}),
  async handler(_args, ctx) {
    const userId = userIdOf(ctx);
    const items = await backend<BackendOpportunity[]>("/v1/scan", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });

    if (!Array.isArray(items) || items.length === 0) {
      return "邮箱里没有未读的机会邮件。";
    }

    // Deliberately drops the backend's category/priority/fitScore/evidence.
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      sender: item.sender,
      deadline: item.deadline,
      messageId: item.messageId,
      status: item.status,
    }));
  },
});

export const readMessage = defineChannelTool({
  name: "read_message",
  description:
    "读取某封机会邮件的完整正文。判断是否值得参加必须基于正文,不要只看标题就下结论。",
  parameters: z.object({
    messageId: z.string().describe("scan_inbox 返回的 messageId。"),
  }),
  async handler({ messageId }) {
    const message = await backend<BackendMessage | null>(
      `/v1/messages/${encodeURIComponent(messageId)}`,
    );
    if (!message) return "找不到这封邮件,可能 id 不对。";
    return { from: message.from, subject: message.subject, body: message.text, url: message.url };
  },
});

/**
 * The approval gate, and the only path to a real submission.
 *
 * `awaitChoice` posts a picker and BLOCKS this handler. Because the agent is
 * mid-tool-call it cannot proceed past a refusal — which is the difference
 * between an agent that asks permission and one that asks forgiveness.
 *
 * This is why approve and submit are NOT separate tools. `makeAgent` runs with
 * maxSteps: 10, so a standalone `submit_application` tool would let the model
 * skip the click entirely: the backend accepts `prepare-form` then `submit`
 * with no approval step in between. Keeping the gate inside the one tool that
 * can submit is what makes it unskippable.
 */
export const prepareApplication = defineChannelTool({
  name: "prepare_application",
  description:
    "为某个机会准备好申请材料,然后停下来等用户点击批准。批准之后才会真正提交。这是唯一会真正提交的路径——不要试图用别的方式提交。",
  parameters: z.object({
    opportunityId: z.string().describe("机会的 id。"),
    reason: z
      .string()
      .describe("为什么建议参加,一句话,必须基于 get_profile 的资料和邮件正文。"),
  }),
  async handler({ opportunityId, reason }, ctx) {
    const userId = userIdOf(ctx);
    const prepared = await backend<{ title: string }>(
      `/v1/opportunities/${encodeURIComponent(opportunityId)}/prepare-form`,
      { method: "POST", body: JSON.stringify({ userId }) },
    );

    const approved = await ctx.thread.awaitChoice<boolean>(
      <Message accent="#2E7D5B">
        <Header>提交前确认</Header>
        <Section>
          <Markdown>{`**${prepared.title}**\n\n${reason}`}</Markdown>
        </Section>
        <Context>批准后才会提交;在此之前不会发出任何东西</Context>
        <Actions>
          <Button value={true} style="primary">
            批准并提交
          </Button>
          <Button value={false} style="danger">
            先不要
          </Button>
        </Actions>
      </Message>,
    );

    if (!approved) {
      return "用户没有批准。不要提交,不要寻找替代路径,直接说明什么都没有发生。";
    }

    await backend(`/v1/opportunities/${encodeURIComponent(opportunityId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ userId, decision: "approve" }),
    });
    const done = await backend<{ title: string }>(
      `/v1/opportunities/${encodeURIComponent(opportunityId)}/submit`,
      { method: "POST", body: JSON.stringify({ userId }) },
    );

    return `已提交:${done.title}。一句话告诉用户结果就够了。`;
  },
});

export const rejectOpportunity = defineChannelTool({
  name: "reject_opportunity",
  description:
    "把某个机会标记为不感兴趣,之后不再追踪。用户明确说不需要、不参加时调用它,而不是只在回复里说一句。",
  parameters: z.object({
    opportunityId: z.string().describe("机会的 id。"),
  }),
  async handler({ opportunityId }, ctx) {
    const userId = userIdOf(ctx);
    const item = await backend<{ title: string }>(
      `/v1/opportunities/${encodeURIComponent(opportunityId)}/approve`,
      { method: "POST", body: JSON.stringify({ userId, decision: "reject" }) },
    );
    return `已忽略:${item.title}`;
  },
});
