import { spawn } from "node:child_process";
import type { MailboxAdapter } from "./mailbox.js";
import type { DemoProfile } from "./demo.js";
import { DemoStore } from "./demo.js";
import { scanMailbox } from "./agent.js";
import { Store } from "../store.js";

const TRIGGER = "AIAGENTHACKTHON";

export class MailMonitor {
  private timer?: NodeJS.Timeout;
  private running = false;
  private seen = new Set<string>();

  constructor(private readonly store: Store, private readonly mailbox: () => MailboxAdapter, private readonly demos: DemoStore, private readonly userId: string, private readonly port: number) {}

  start() {
    const interval = Math.max(5000, Number(process.env.MAIL_POLL_INTERVAL_MS ?? 15000));
    void this.tick();
    this.timer = setInterval(() => void this.tick(), interval);
    return interval;
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const opportunities = await scanMailbox(this.store, this.mailbox(), this.userId);
      for (const item of opportunities) {
        if (this.seen.has(item.messageId)) continue;
        this.seen.add(item.messageId);
        const message = this.store.messages.get(item.messageId);
        if (!message || !message.text.toUpperCase().includes(TRIGGER)) continue;
        const profile = this.store.profiles.get(this.userId);
        const session = this.demos.create(message.to || "demo@example.com");
        this.demos.login(session.id, session.email);
        const filled: Partial<DemoProfile> = {
          firstName: profile?.name?.split(/\s+/)[0] ?? "Demo", lastName: profile?.name?.split(/\s+/).slice(1).join(" ") || "User",
          companyName: profile?.school ?? "Demo Labs", jobTitle: profile?.program ?? "AI Engineer",
          biography: profile?.bio ?? "Builds useful AI agents.", currentProjects: profile?.projects?.join("; ") ?? "AI Agent Hackathon",
          skills: profile?.skills?.join(", ") ?? "TypeScript, Python", areasOfInterest: profile?.interests?.join(", ") ?? "AI agents",
          introPreference: "open", contactPreference: "email", role: "student", employment: [], helpWith: [], lookingFor: [],
        };
        this.demos.fillProfile(session.id, filled);
        const url = `http://localhost:${this.port}/hackathon/signin.html?sessionId=${encodeURIComponent(session.id)}`;
        console.log(`[mail-monitor] ${TRIGGER} detected; demo ready: ${url}`);
        if (process.env.OPEN_DEMO_BROWSER !== "false") openBrowser(url);
      }
    } catch (error) { console.error("[mail-monitor] scan failed", error); }
    finally { this.running = false; }
  }
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
