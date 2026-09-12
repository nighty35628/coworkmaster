import { randomUUID } from "node:crypto";
import type { MailMessage } from "../types.js";

export interface MailboxAdapter {
  testConnection(): Promise<{ imap: boolean; smtp: boolean; message: string }>;
  listUnread(): Promise<MailMessage[]>;
  send(message: { to: string; subject: string; text: string; inReplyTo?: string }): Promise<{ messageId: string }>;
}

/** Deterministic adapter for local development and the two-minute demo. */
export class MockMailboxAdapter implements MailboxAdapter {
  private readonly messages: MailMessage[] = [{
    id: "demo-hackathon-1", accountId: "demo", from: "events@hkust.example",
    to: "student@example.com", subject: "HKUST AI Hackathon — Registration closes tonight",
    text: "Join our AI hackathon. Registration closes tonight at 23:59. Apply here: https://example.test/hackathon-form",
    receivedAt: new Date().toISOString(), unread: true, url: "https://example.test/hackathon-form"
  }];
  async testConnection() { return { imap: true, smtp: true, message: "Demo mailbox is ready" }; }
  async listUnread() { return this.messages.filter((message) => message.unread); }
  async send(_message: { to: string; subject: string; text: string; inReplyTo?: string }) { return { messageId: `<${randomUUID()}@demo.local>` }; }
}
