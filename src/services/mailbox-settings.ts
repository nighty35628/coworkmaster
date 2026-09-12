import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailboxConfig } from "./mailbox.js";

/** Local single-account storage. Passwords are never included in API status. */
export class MailboxSettings {
  private readonly file: string;
  private config: MailboxConfig | null;

  constructor(private readonly directory = join(process.cwd(), ".data")) {
    this.file = join(directory, "mailbox.json");
    this.config = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : null;
  }

  load() { return this.config; }

  resolve(input?: Partial<MailboxConfig>): MailboxConfig {
    if (!input?.imap && !input?.smtp) {
      if (!this.config) throw new Error("尚未保存邮箱，请先填写 IMAP / SMTP 账号信息。");
      return this.config;
    }
    const result = {} as MailboxConfig;
    for (const protocol of ["imap", "smtp"] as const) {
      const value = input[protocol];
      const previous = this.config?.[protocol];
      const user = (value?.user ?? value?.username ?? "").trim();
      const host = (value?.host ?? "").trim();
      const sameAccount = previous?.host === host && (previous.user ?? previous.username) === user;
      const password = value?.password || (sameAccount ? previous?.password : "");
      const port = Number(value?.port ?? (protocol === "imap" ? 993 : 465));
      if (!user || !host || !password) throw new Error(`${protocol.toUpperCase()} 主机、账号和密码不能为空；切换账号时请重新输入密码。`);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("邮箱端口需在 1–65535 之间。");
      result[protocol] = { host, port, user, password, secure: value?.secure ?? (protocol === "imap" ? port === 993 : port !== 587) };
    }
    return result;
  }

  save(config: MailboxConfig) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.file);
    this.config = config;
  }

  publicConfig() {
    if (!this.config) return null;
    const { password: _imapPassword, ...imap } = this.config.imap;
    const { password: _smtpPassword, ...smtp } = this.config.smtp;
    return { imap, smtp };
  }
}
