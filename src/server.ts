import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { ImapSmtpMailboxAdapter, MockMailboxAdapter, type MailboxConfig, type MailboxAdapter } from "./services/mailbox.js";
import { scanMailbox } from "./services/agent.js";
import { DemoStore } from "./services/demo.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(fastifyStatic, {
  root: join(fileURLToPath(new URL(".", import.meta.url)), "../public"),
  index: "index.html",
});
const store = new Store();
let mailbox: MailboxAdapter = new MockMailboxAdapter();
let mailboxConfig: MailboxConfig | null = null;
const defaultUser = "demo-user";
const demos = new DemoStore();

app.get("/v1/health", async () => ({ ok: true, service: "opportunity-autopilot", demoMode: true }));
app.post<{ Body: { email?: string } }>("/v1/demo/sessions", async (request) => {
  const session = demos.create(request.body?.email);
  return { sessionId: session.id, stage: session.stage, email: session.email, displayUrl: `/hackathon/signin.html?sessionId=${encodeURIComponent(session.id)}` };
});
app.get<{ Params: { id: string } }>("/v1/demo/sessions/:id", async (request, reply) => {
  const session = demos.get(request.params.id);
  return session ?? reply.code(404).send({ error: "demo_session_not_found" });
});
app.post<{ Params: { action: string }; Body: { sessionId?: string; email?: string; profile?: Record<string, unknown> } }>("/v1/demo/trigger/:action", async (request, reply) => {
  const sessionId = request.body?.sessionId;
  if (!sessionId) return reply.code(400).send({ error: "sessionId_required" });
  try {
    if (request.params.action === "login") {
      if (!request.body.email) return reply.code(400).send({ error: "email_required" });
      return demos.login(sessionId, request.body.email);
    }
    if (request.params.action === "fill-profile") {
      const result = demos.fillProfile(sessionId, (request.body.profile ?? {}) as any);
      if (result.missing.length) return reply.code(422).send({ error: "missing_profile_fields", missing: result.missing, session: result.session });
      return result.session;
    }
    if (request.params.action === "submit") {
      const result = demos.submit(sessionId);
      if (result.error) return reply.code(409).send({ error: result.error, session: result.session });
      return result.session;
    }
    return reply.code(404).send({ error: "unknown_demo_action" });
  } catch (error) {
    if (error instanceof Error && error.message === "demo_session_not_found") return reply.code(404).send({ error: error.message });
    throw error;
  }
});
app.post<{ Body: MailboxConfig }>("/v1/accounts/test", async (request, reply) => {
  try {
    const candidate = new ImapSmtpMailboxAdapter(request.body);
    return await candidate.testConnection();
  } catch (error) {
    return reply.code(400).send({ imap: false, smtp: false, message: error instanceof Error ? error.message : String(error) });
  }
});
app.post<{ Body: MailboxConfig }>("/v1/accounts/connect", async (request, reply) => {
  try {
    const candidate = new ImapSmtpMailboxAdapter(request.body);
    const result = await candidate.testConnection();
    if (!result.imap || !result.smtp) return reply.code(400).send(result);
    mailbox = candidate; mailboxConfig = request.body;
    return { connected: true, imap: result.imap, smtp: result.smtp, message: result.message };
  } catch (error) { return reply.code(400).send({ connected: false, message: error instanceof Error ? error.message : String(error) }); }
});
app.get("/v1/accounts/status", async () => ({ connected: mailboxConfig !== null, mode: mailboxConfig ? "imap-smtp" : "demo" }));
app.get<{ Querystring: { userId?: string } }>("/v1/profile", async (request, reply) => {
  const profile = store.profiles.get(request.query.userId ?? defaultUser); return profile ?? null;
});
app.post<{ Body: any }>("/v1/profile", async (request, reply) => {
  const body = (request.body ?? {}) as any; if (!body.name) return reply.code(400).send({ error: "name_required" });
  return store.upsertProfile({ userId: body.userId ?? defaultUser, name: body.name, school: body.school, program: body.program, interests: body.interests ?? [], skills: body.skills ?? [], projects: body.projects ?? [], links: body.links ?? [], bio: body.bio });
});
app.post<{ Body: { userId?: string } }>("/v1/scan", async (request) => scanMailbox(store, mailbox, request.body?.userId ?? defaultUser));
app.get("/v1/messages", async () => {
  const reader = mailbox as MailboxAdapter & { listMessages?: () => Promise<unknown[]> };
  const messages = reader.listMessages ? await reader.listMessages() : await mailbox.listUnread();
  return { messages };
});
app.get<{ Params: { id: string } }>("/v1/messages/:id", async (request, reply) => {
  const reader = mailbox as MailboxAdapter & { getMessage?: (id: string) => Promise<unknown | null> };
  const message = reader.getMessage ? await reader.getMessage(request.params.id) : store.messages.get(request.params.id);
  return message ?? reply.code(404).send({ error: "message_not_found" });
});
app.post<{ Body: { to: string; subject: string; text: string } }>("/v1/send", async (request) => mailbox.send(request.body));
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
app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject" } }>("/v1/opportunities/:id/decision", async (request, reply) => { const item = store.opportunities.get(request.params.id); if (!item) return reply.code(404).send({ error: "opportunity_not_found" }); return store.updateOpportunity(item.id, { status: request.body.decision === "approve" ? "WAITING_APPROVAL" : "REJECTED" }); });
app.post<{ Params: { id: string } }>("/v1/opportunities/:id/submit", async (request, reply) => { const item = store.opportunities.get(request.params.id); if (!item) return reply.code(404).send({ error: "opportunity_not_found" }); if (item.status !== "WAITING_APPROVAL") return reply.code(409).send({ error: "approval_required" }); const message = store.messages.get(item.messageId); const sent = await mailbox.send({ to: message?.from ?? "demo@example.test", subject: `Re: ${item.title}`, text: item.draft ?? "Please find my application attached." }); return store.updateOpportunity(item.id, { status: item.form ? "SUBMITTED" : "SENT", evidence: [...item.evidence, `Sent with message id ${sent.messageId}`] }); });
app.post<{ Body: { opportunityId?: string; userId?: string; kind: string; comment?: string } }>("/v1/feedback/events", async (request) => { const event = { id: randomUUID(), opportunityId: request.body.opportunityId, userId: request.body.userId ?? defaultUser, kind: request.body.kind, comment: request.body.comment, createdAt: new Date().toISOString() }; store.feedback.push(event); return event; });

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: process.env.HOST ?? "0.0.0.0" }).catch((error) => { app.log.error(error); process.exit(1); });
