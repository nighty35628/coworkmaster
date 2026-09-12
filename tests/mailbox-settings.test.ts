import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailboxSettings } from "../src/services/mailbox-settings.js";

test("saved account survives restart, hides secrets, and reuses a blank password only for the same account", () => {
  const directory = mkdtempSync(join(tmpdir(), "coworkmaster-settings-"));
  try {
    const settings = new MailboxSettings(directory);
    const config = {
      imap: { host: "imap.example.test", port: 993, secure: true, user: "test@example.test", password: "test-only-password" },
      smtp: { host: "smtp.example.test", port: 465, secure: true, user: "test@example.test", password: "test-only-password" },
    };
    settings.save(settings.resolve(config));
    const restored = new MailboxSettings(directory);
    assert.deepEqual(restored.load(), config);
    assert.deepEqual(restored.resolve({}), config);
    assert.deepEqual(restored.resolve({ ...config, imap: { ...config.imap, password: "" } }), config);
    assert.equal("password" in restored.publicConfig()!.imap, false);
    assert.equal("password" in restored.publicConfig()!.smtp, false);
    assert.equal(JSON.stringify(restored.publicConfig()).includes("test-only-password"), false);
    assert.equal(statSync(join(directory, "mailbox.json")).mode & 0o777, 0o600);
    assert.throws(() => restored.resolve({ ...config, imap: { ...config.imap, user: "other@example.test", password: "" } }));
    assert.throws(() => restored.resolve({ ...config, imap: { ...config.imap, host: "other.example.test", password: "" } }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
