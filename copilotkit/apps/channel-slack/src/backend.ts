/**
 * HTTP client for the Opportunity backend.
 *
 * The backend owns data and IO only: profile, mailbox, opportunity state, and
 * the approval state machine. All reasoning lives in the CopilotKit agent, so
 * nothing in here calls a model.
 *
 * The backend does ship its own DeepSeek classification. It is deliberately
 * left unused — see the note at the top of opportunity-tools.tsx.
 */

const BASE = (process.env.BACKEND_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

/**
 * Backend calls sit on the agent's critical path, so a hung socket has to fail
 * the tool call rather than the thread. The backend's own Slack client has no
 * timeout; this one does.
 */
const TIMEOUT_MS = 8_000;

export async function backend<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `后端不可达 (${BASE}${path}): ${
        error instanceof Error ? error.message : String(error)
      }. 确认后端已启动后再重试,不要臆测数据。`,
    );
  }

  if (!response.ok) {
    throw new Error(`后端返回 ${response.status} (${path}): ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

/**
 * The single place identity is resolved.
 *
 * `identifyUser: "platform"` in channel.tsx makes `ctx.user` the canonical
 * platform user (provider + workspace + platform user id). It is nullable —
 * a provider that cannot resolve an application user still dispatches an
 * actor — so fall back to the raw provider actor id.
 *
 * No tool takes a userId parameter. That is deliberate: identity the model can
 * type is identity the model can get wrong, or point at someone else.
 */
export function userIdOf(ctx: { user: { id: string } | null; actor: { id: string } }): string {
  return ctx.user?.id ?? ctx.actor.id;
}
