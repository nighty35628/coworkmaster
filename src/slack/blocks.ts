import type { View } from "@slack/types";
import type { Opportunity, UserProfile } from "./types.js";

// Slack's generated block union is intentionally strict; keeping these
// builders structural makes the demo adapter easy to evolve with new blocks.
type BlockLike = any;

const text = (value: string) => ({ type: "mrkdwn" as const, text: value });

function scoreLabel(score?: number): string {
  if (score === undefined) return "未评分";
  return `${Math.round(score * 100)}%`;
}

export function opportunityCard(opportunity: Opportunity): any[] {
  const reasons = opportunity.fitReasons?.length
    ? `\n*匹配理由*\n${opportunity.fitReasons.map((reason) => `• ${reason}`).join("\n")}`
    : "";
  const details = [
    opportunity.category ? `分类：*${opportunity.category}*` : undefined,
    opportunity.priority ? `优先级：*${opportunity.priority}*` : undefined,
    opportunity.deadline ? `截止：*${opportunity.deadline}*` : undefined,
    `匹配度：*${scoreLabel(opportunity.fitScore)}*`,
  ].filter(Boolean).join("  ·  ");

  return [
    { type: "header", text: { type: "plain_text", text: `📬 ${opportunity.title}` } },
    { type: "section", text: text(`${details}${opportunity.sender ? `\n来自：${opportunity.sender}` : ""}`) },
    ...(opportunity.summary ? [{ type: "section", text: text(opportunity.summary) }] : []),
    ...(reasons ? [{ type: "section", text: text(reasons) }] : []),
    {
      type: "actions",
      block_id: `opportunity_actions_${opportunity.id}`,
      elements: [
        { type: "button", action_id: "opportunity_review", text: { type: "plain_text", text: "查看并准备" }, value: opportunity.id },
        { type: "button", action_id: "opportunity_reject", text: { type: "plain_text", text: "忽略" }, style: "danger", value: opportunity.id },
      ],
    },
    { type: "context", elements: [text(`ID: \`${opportunity.id}\``)] },
  ] as any;
}

export function reviewView(opportunity: Opportunity): View {
  const draft = opportunity.draft;
  const fieldText = draft?.fields
    ? Object.entries(draft.fields).map(([key, value]) => `*${key}*\n${value}`).join("\n\n")
    : draft?.body || "Agent 尚未准备内容。点击准备后再试。";
  return ({
    type: "modal",
    callback_id: "opportunity_review_submit",
    private_metadata: JSON.stringify({ opportunityId: opportunity.id, version: draft?.version }),
    title: { type: "plain_text", text: "确认 Agent 草稿" },
    submit: { type: "plain_text", text: "批准并执行" },
    close: { type: "plain_text", text: "取消" },
    blocks: [
      { type: "section", text: text(`*${opportunity.title}*\n${opportunity.summary || ""}`) },
      ...(opportunity.deadline ? [{ type: "context", elements: [text(`截止：${opportunity.deadline}`)] }] : []),
      { type: "input", block_id: "draft_body", label: { type: "plain_text", text: "准备内容" }, element: { type: "plain_text_input", action_id: "body", multiline: true, initial_value: fieldText } },
      { type: "context", elements: [text("批准后才会提交表单或发送邮件。提交前 Agent 会重新确认邮件没有变化。")] },
    ],
  } as any);
}

export function profileView(profile?: UserProfile | null): View {
  const p = profile || { name: "" };
  const input = (blockId: string, label: string, value = "", multiline = false) => ({
    type: "input" as const,
    block_id: blockId,
    label: { type: "plain_text" as const, text: label },
    element: { type: "plain_text_input" as const, action_id: "value", initial_value: value, multiline },
  });
  return ({
    type: "modal",
    callback_id: "profile_submit",
    title: { type: "plain_text", text: "你的 WhenAgent 资料" },
    submit: { type: "plain_text", text: "保存" },
    close: { type: "plain_text", text: "取消" },
    blocks: [
      input("name", "姓名", p.name),
      input("school", "学校", p.school),
      input("program", "专业 / 年级", [p.program, p.year].filter(Boolean).join(" / ")),
      input("interests", "兴趣（用逗号分隔）", p.interests?.join(", ")),
      input("skills", "技能（用逗号分隔）", p.skills?.join(", ")),
      input("projects", "项目经历", typeof p.projects === "string" ? p.projects : (p.projects || []).join("; "), true),
      input("links", "GitHub / 作品集", [p.github, p.portfolio].filter(Boolean).join("\n")),
      input("bio", "个人简介", p.bio, true),
    ],
  } as any);
}

export function inboxBlocks(opportunities: Opportunity[]): BlockLike[] {
  if (!opportunities.length) return [{ type: "section", text: text("📭 暂时没有需要处理的邮件。") }];
  return opportunities.flatMap((item, index) => [
    ...(index ? [{ type: "divider" as const }] : []),
    ...opportunityCard(item),
  ]);
}

/**
 * The App Home is intentionally a compact operating view: counts first,
 * actions second, then the source email/opportunity context that explains
 * why an item is on the user's list.
 */
export function homeView(opportunities: Opportunity[], error?: string): View {
  const categoryCounts = opportunities.reduce<Record<string, number>>((counts, item) => {
    const category = item.category || "未分类";
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const categorySummary = Object.entries(categoryCounts).length
    ? Object.entries(categoryCounts).map(([category, count]) => `*${category}* ${count}`).join("   ·   ")
    : "暂无分类";
  const todo = opportunities.filter((item) => !["SUBMITTED", "SENT", "REJECTED"].includes(item.status || ""));
  const raw = opportunities.slice(0, 5);

  const todoBlocks: BlockLike[] = todo.length
    ? todo.slice(0, 4).flatMap((item, index) => [
      ...(index ? [{ type: "divider" as const }] : []),
      { type: "section", text: text(`*${item.title}*\n${item.priority ? `优先级：${item.priority}` : "待处理"}${item.deadline ? `  ·  截止：${item.deadline}` : ""}`), accessory: { type: "button", action_id: "opportunity_review", text: { type: "plain_text", text: "查看并准备" }, value: item.id } },
    ])
    : [{ type: "section", text: text("✅ 当前没有待办事项。") }];

  const rawBlocks: BlockLike[] = raw.length
    ? raw.flatMap((item, index) => [
      ...(index ? [{ type: "divider" as const }] : []),
      { type: "section", text: text(`*${item.title}*\n${item.sender ? `来自：${item.sender}` : "来源未知"}${item.summary ? `\n${item.summary}` : ""}`), accessory: { type: "button", action_id: "opportunity_review", text: { type: "plain_text", text: "打开" }, value: item.id } },
    ])
    : [{ type: "section", text: text("📭 暂时没有可展示的原始邮件。点击“刷新”扫描一次。") }];

  return ({
    type: "home",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "WhenAgent 工作台" } },
      { type: "section", text: text("Agent 会持续观察邮箱，把重要邮件整理成分类、待办和可执行的下一步。") },
      ...(error ? [{ type: "section", text: text(`⚠️ 本次刷新失败：${error}`) }] : []),
      { type: "actions", elements: [
        { type: "button", action_id: "home_refresh", text: { type: "plain_text", text: "刷新邮箱" }, style: "primary" },
        { type: "button", action_id: "home_profile", text: { type: "plain_text", text: "设置资料" } },
      ] },
      { type: "divider" },
      { type: "section", text: text(`*分类概览*\n${categorySummary}`) },
      { type: "header", text: { type: "plain_text", text: "待办" } },
      ...todoBlocks,
      { type: "header", text: { type: "plain_text", text: "原始邮件 / 机会" } },
      ...rawBlocks,
      { type: "context", elements: [text("打开本页会刷新一次邮箱；Agent 只准备内容，提交前仍需要你的确认。")] },
    ],
  } as any);
}
