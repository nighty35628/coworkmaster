import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = process.env.PORT || "8787";
const url = `http://localhost:${port}`;
async function ready() {
  try {
    const response = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.json()).service === "opportunity-autopilot";
  } catch { return false; }
}
if (await ready()) {
  console.log(`Mailbox console already running: ${url}`);
} else {
  const data = new URL("../.data/", import.meta.url);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const logfile = new URL("server.log", data);
  const log = openSync(logfile, "a", 0o600);
  chmodSync(logfile, 0o600);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: root, env: { ...process.env, HOST: process.env.HOST || "127.0.0.1" },
    detached: true, stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  writeFileSync(new URL("server.pid", data), String(child.pid), { mode: 0o600 });
  let started = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (await ready()) { started = true; break; }
  }
  if (!started) { console.error("启动失败，请查看 .data/server.log。"); process.exitCode = 1; }
  else console.log(`Mailbox console running in background: ${url} (PID ${child.pid})`);
}
