import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { Store } from "./store.js";
import { MockMailboxAdapter } from "./services/mailbox.js";
import { scanMailbox } from "./services/agent.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
const store = new Store();
const mailbox = new MockMailboxAdapter();
const defaultUser = "demo-user";

app.get("/v1/health", async () => ({ ok: true, service: "opportunity-autopilot", demoMode: true }));
app.post<{ Body: any }>("/v1/accounts/test", async () => mailbox.testConnection());
app.get<{ Querystring: { userId?: string } }>("/v1/profile", async (request, reply) => {
  const profile = store.profiles.get(request.query.userId ?? defaultUser); if (!profile) return reply.code(404).send({ error: "profile_not_found" }); return profile;
});
app.post<{ Body: any }>("/v1/profile", async (request, reply) => {
  const body = (request.body ?? {}) as any; if (!body.name) return reply.code(400).send({ error: "name_required" });
  return store.upsertProfile({ userId: body.userId ?? defaultUser, name: body.name, school: body.school, program: body.program, interests: body.interests ?? [], skills: body.skills ?? [], projects: body.projects ?? [], links: body.links ?? [], bio: body.bio });
});
app.post<{ Body: { userId?: string } }>("/v1/scan", async (request) => ({ opportunities: await scanMailbox(store, mailbox, request.body?.userId ?? defaultUser) }));
app.get("/v1/opportunities", async () => ({ opportunities: [...store.opportunities.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
app.get<{ Params: { id: string } }>("/v1/opportunities/:id", async (request, reply) => { const item = store.opportunities.get(request.params.id); return item ?? reply.code(404).send({ error: "opportunity_not_found" }); });
app.post<{ Params: { id: string } }>("/v1/opportunities/:id/prepare-form", async (request, reply) => {
  const item = store.opportunities.get(request.params.id); if (!item) return reply.code(404).send({ error: "opportunity_not_found" });
  const message = store.messages.get(item.messageId); const profile = store.profiles.get(defaultUser);
  const fields = { name: profile?.name ?? "", school: profile?.school ?? "", program: profile?.program ?? "", bio: profile?.bio ?? "", projects: (profile?.projects ?? []).join("; ") };
  const prepared = store.updateOpportunity(item.id, { form: { url: message?.url ?? "https://example.test/hackathon-form", fields, preparedAt: new Date().toISOString() }, draft: `I would like to apply for ${item.title}.`, status: "WAITING_APPROVAL" });
  return prepared;
});
app.patch<{ Params: { id: string }; Body: { draft?: string; fields?: Record<string, string> } }>("/v1/opportunities/:id/draft", async (request, reply) => { const item = store.opportunities.get(request.params.id); if (!item) return reply.code(404).send({ error: "opportunity_not_found" }); return store.updateOpportunity(item.id, { draft: request.body.draft ?? item.draft, form: item.form && request.body.fields ? { ...item.form, fields: request.body.fields } : item.form }); });
app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject" } }>("/v1/opportunities/:id/approve", async (request, reply) => { const item = store.opportunities.get(request.params.id); if (!item) return reply.code(404).send({ error: "opportunity_not_found" }); return store.updateOpportunity(item.id, { status: request.body.decision === "approve" ? "WAITING_APPROVAL" : "REJECTED" }); });
app.post<{ Params: { id: string } }>("/v1/opportunities/:id/submit", async (request, reply) => { const item = store.opportunities.get(request.params.id); if (!item) return reply.code(404).send({ error: "opportunity_not_found" }); if (item.status !== "WAITING_APPROVAL") return reply.code(409).send({ error: "approval_required" }); const message = store.messages.get(item.messageId); const sent = await mailbox.send({ to: message?.from ?? "demo@example.test", subject: `Re: ${item.title}`, text: item.draft ?? "Please find my application attached." }); return store.updateOpportunity(item.id, { status: item.form ? "SUBMITTED" : "SENT", evidence: [...item.evidence, `Sent with message id ${sent.messageId}`] }); });
app.post<{ Body: { opportunityId?: string; userId?: string; kind: string; comment?: string } }>("/v1/feedback/events", async (request) => { const event = { id: randomUUID(), opportunityId: request.body.opportunityId, userId: request.body.userId ?? defaultUser, kind: request.body.kind, comment: request.body.comment, createdAt: new Date().toISOString() }; store.feedback.push(event); return event; });

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: process.env.HOST ?? "0.0.0.0" }).catch((error) => { app.log.error(error); process.exit(1); });
