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
  return { category, priority: category === "opportunity" && action ? "high" : category === "noise" ? "low" : "medium", fitScore, deadline, matches } as const;
}

export async function scanMailbox(store: Store, mailbox: { listUnread: () => Promise<MailMessage[]> }, userId: string) {
  const profile = store.profiles.get(userId);
  const messages = await mailbox.listUnread();
  return messages.map((message) => {
    store.addMessage(message);
    const result = classify(message, profile);
    const existing = [...store.opportunities.values()].find((item) => item.messageId === message.id);
    if (existing) return existing;
    return store.addOpportunity({ messageId: message.id, category: result.category, priority: result.priority, title: message.subject,
      deadline: result.deadline, fitScore: result.fitScore, evidence: [result.matches.length ? `Matches profile: ${result.matches.join(", ")}` : "Actionable content detected"],
      nextAction: result.category === "opportunity" ? "complete_registration" : "review", status: "QUALIFIED" });
  });
}
