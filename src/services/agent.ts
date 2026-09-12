import type { MailMessage, Opportunity, UserProfile } from "../types.js";
import { Store } from "../store.js";

const opportunityWords = /(hackathon|competition|scholarship|internship|fellowship|apply|registration|报名|申请)/i;
const actionWords = /(deadline|closes|submit|confirm|required|截止|回复|提交)/i;

export function classify(message: MailMessage, profile?: UserProfile) {
  const content = `${message.subject}\n${message.text}`;
  const opportunity = opportunityWords.test(content);
  const action = actionWords.test(content);
  const category = opportunity ? "opportunity" : action ? "action_required" : /unsubscribe|newsletter|sale/i.test(content) ? "noise" : "informational";
  const fitTerms = [...(profile?.interests ?? []), ...(profile?.skills ?? []), ...(profile?.school ? [profile.school] : [])].filter(Boolean);
  const matches = fitTerms.filter((term) => content.toLowerCase().includes(term.toLowerCase()));
  const fitScore = Math.min(0.98, Math.max(0.25, (opportunity ? 0.55 : 0.25) + matches.length * 0.12 + (action ? 0.12 : 0)));
  const deadline = content.match(/(?:tonight|today|截止[^。\n]*|\d{1,2}:\d{2})/i)?.[0];
  return { category, priority: category === "opportunity" && action ? "high" : category === "noise" ? "low" : "medium", fitScore, deadline, matches,
    evidence: [matches.length ? `Matches profile: ${matches.join(", ")}` : "Actionable content detected"] } as const;
}

async function classifyWithDeepSeek(message: MailMessage, profile?: UserProfile) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return classify(message, profile);
  const base = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat", temperature: 0.1,
      response_format: { type: "json_object" }, messages: [
        { role: "system", content: "Classify this email for a student opportunity agent. Return JSON with category (opportunity|action_required|informational|noise), priority, fitScore (0-1), deadline, nextAction, evidence (array)." },
        { role: "user", content: JSON.stringify({ email: { subject: message.subject, text: message.text }, profile }) }
      ] })
  });
  if (!response.ok) return classify(message, profile);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}");
    if (!parsed.category) return classify(message, profile);
    return { ...classify(message, profile), ...parsed, fitScore: Number(parsed.fitScore ?? 0.5) };
  } catch { return classify(message, profile); }
}

export async function scanMailbox(store: Store, mailbox: { listUnread: () => Promise<MailMessage[]> }, userId: string) {
  const profile = store.profiles.get(userId);
  const messages = await mailbox.listUnread();
  const results = [];
  for (const message of messages) {
    store.addMessage(message);
    const result = await classifyWithDeepSeek(message, profile);
    const existing = [...store.opportunities.values()].find((item) => item.messageId === message.id);
    if (existing) { results.push(existing); continue; }
    results.push(store.addOpportunity({ messageId: message.id, category: result.category, priority: result.priority, title: message.subject,
      sender: message.from, summary: message.text.slice(0, 240), fitReasons: result.evidence ?? [], action: result.nextAction, sourceUrl: message.url,
      deadline: result.deadline, fitScore: result.fitScore, evidence: result.evidence ?? [result.matches?.length ? `Matches profile: ${result.matches.join(", ")}` : "Actionable content detected"],
      nextAction: result.nextAction ?? (result.category === "opportunity" ? "complete_registration" : "review"), status: "QUALIFIED" }));
  }
  return results;
}
