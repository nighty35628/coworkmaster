import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { MailMessage } from "../types.js";

export interface MailboxAdapter {
  testConnection(): Promise<{ imap: boolean; smtp: boolean; message: string }>;
  listUnread(): Promise<MailMessage[]>;
  send(message: { to: string; subject: string; text: string; inReplyTo?: string }): Promise<{ messageId: string }>;
}

export interface MailboxConfig {
  imap: { host: string; port?: number; secure?: boolean; user?: string; username?: string; password: string };
  smtp: { host: string; port?: number; secure?: boolean; user?: string; username?: string; password: string };
}

type MailServer = MailboxConfig["imap"];

function auth(server: MailServer) {
  return { user: server.user ?? server.username ?? "", pass: server.password };
}

/** Direct IMAP/SMTP adapter; server restores its config from local settings. */
export class ImapSmtpMailboxAdapter implements MailboxAdapter {
  constructor(private readonly config: MailboxConfig) {}

  private imap() {
    const server = this.config.imap;
    const client = new ImapFlow({ host: server.host, port: server.port ?? 993, secure: server.secure ?? true, auth: auth(server), logger: false,
      connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000 });
    // Closing rejects pending commands; a socket error must not crash the API process.
    client.on("error", () => client.close());
    return client;
  }

  private transporter() {
    const server = this.config.smtp;
    return nodemailer.createTransport({ host: server.host, port: server.port ?? 465, secure: server.secure ?? true, auth: auth(server),
      connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000 });
  }

  async testConnection() {
    const client = this.imap();
    const transport = this.transporter();
    const results = await Promise.allSettled([
      (async () => { try { await client.connect(); } finally { await client.logout().catch(() => undefined); } })(),
      transport.verify().finally(() => transport.close()),
    ]);
    const describe = (name: string, result: PromiseSettledResult<unknown>) => {
      if (result.status === "fulfilled") return `${name} 连接成功`;
      const error = result.reason;
      return `${name}: ${error?.responseText || error?.response || error?.message || "连接失败"}`;
    };
    return { imap: results[0].status === "fulfilled", smtp: results[1].status === "fulfilled",
      message: `${describe("IMAP", results[0])}；${describe("SMTP", results[1])}` };
  }

  private async readMessages(criteria: Record<string, unknown>) {
    const client = this.imap();
    const messages: MailMessage[] = [];
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const found = await client.search(criteria, { uid: true });
        const uids = Array.isArray(found) ? found : [];
        if (!uids.length) return messages;
        for await (const item of client.fetch(uids.slice(-50), { uid: true, envelope: true, source: true, flags: true, internalDate: true }, { uid: true })) {
          const parsed = await simpleParser(item.source ?? Buffer.from(""));
          const from = item.envelope?.from?.[0]?.address ?? "";
          const to = item.envelope?.to?.[0]?.address ?? auth(this.config.imap).user;
          messages.push({
            id: `${item.uid}`,
            accountId: auth(this.config.imap).user,
            from, to, subject: item.envelope?.subject ?? "(no subject)",
            text: parsed.text ?? "", receivedAt: new Date(item.internalDate ?? Date.now()).toISOString(),
            unread: !item.flags?.has("\\Seen"),
          });
        }
      } finally { lock.release(); }
    } finally { try { await client.logout(); } catch { /* best effort */ } }
    return messages.reverse();
  }

  async listUnread() { return this.readMessages({ seen: false }); }
  async listMessages() { return this.readMessages({ all: true }); }
  async getMessage(id: string) { return (await this.listMessages()).find((message) => message.id === id) ?? null; }

  async send(message: { to: string; subject: string; text: string; inReplyTo?: string }) {
    const result = await this.transporter().sendMail({ from: auth(this.config.smtp).user, to: message.to, subject: message.subject, text: message.text, inReplyTo: message.inReplyTo });
    return { messageId: result.messageId };
  }
}

/** Deterministic adapter for local development and the two-minute demo. */
export class MockMailboxAdapter implements MailboxAdapter {
  private readonly messages: MailMessage[] = [{
    id: "demo-hackathon-1", accountId: "demo", from: "events@hkust.example",
    to: "student@example.com", subject: "HKUST AI Hackathon — Registration closes tonight",
    text: "AIAGENTHACKTHON\nJoin our AI hackathon. Registration closes tonight at 23:59. Apply here: https://example.test/hackathon-form",
    receivedAt: new Date().toISOString(), unread: true, url: "https://example.test/hackathon-form"
  }];
  async testConnection() { return { imap: true, smtp: true, message: "Demo mailbox is ready" }; }
  async listUnread() { return this.messages.filter((message) => message.unread); }
  async send(_message: { to: string; subject: string; text: string; inReplyTo?: string }) { return { messageId: `<${randomUUID()}@demo.local>` }; }
}
