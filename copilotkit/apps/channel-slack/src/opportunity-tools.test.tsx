/**
 * These tests run against a REAL backend, not a mock.
 *
 *   cd coworkmaster && npm run dev      # then
 *   npm run test --workspace channel-slack
 *
 * A stub thread is enough to drive the handlers, but the assertions read back
 * through the backend's own HTTP API — so "prepare_application submitted it"
 * means the opportunity really moved to SUBMITTED, not that a mock recorded a
 * call. The test fails loudly if the backend is not up, rather than passing
 * against nothing.
 *
 * Ordering note: `scanMailbox` dedupes opportunities by messageId across the
 * whole store, and the demo mailbox holds exactly one message. So there is one
 * opportunity for the whole file, and the decline case has to run before the
 * approve case. That constraint is the backend's, not this test's.
 */
import { describe, it, mock, before } from "node:test";
import assert from "node:assert/strict";
import { renderToIR } from "@copilotkit/channels";
import { getProfile, scanInbox, readMessage, prepareApplication } from "./opportunity-tools";

const BASE = (process.env.BACKEND_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const USER = "U_TEST_AGENT";
const NOBODY = "U_TEST_NOBODY";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return response.json() as Promise<T>;
}

/** Only the context members these handlers touch. */
const ctxFor = (thread: Record<string, unknown> = {}, userId = USER) =>
  ({
    thread,
    user: { id: userId, name: "test user" },
    actor: { id: "A_TEST" },
    platform: "slack",
  }) as never;

/** The tree the human was actually shown, captured off the blocking call. */
const cardTree = (fn: ReturnType<typeof mock.fn>) =>
  JSON.stringify(renderToIR(fn.mock.calls[0]!.arguments[0] as never));

before(async () => {
  const health = await api<{ ok: boolean }>("/v1/health").catch(() => null);
  assert.ok(health?.ok, `后端没有在 ${BASE} 上运行。先启动它: cd coworkmaster && npm run dev`);

  await api("/v1/profile", {
    method: "POST",
    body: JSON.stringify({
      userId: USER,
      name: "Test User",
      school: "PolyU",
      program: "MSc Blockchain Technology",
      interests: ["AI Agents", "FinTech"],
      skills: ["TypeScript"],
      projects: ["Bus App"],
      links: [],
      bio: "AI undergraduate background",
    }),
  });
});

describe("get_profile", () => {
  it("resolves identity from the channel context, not from tool arguments", async () => {
    const profile = await getProfile.handler({}, ctxFor());
    assert.equal((profile as { name: string }).name, "Test User");
    assert.deepEqual((profile as { interests: string[] }).interests, ["AI Agents", "FinTech"]);

    // The model cannot name a different user. There is no userId parameter, and
    // zod strips unknown keys, so a smuggled one is ignored rather than honoured.
    const smuggled = await getProfile.handler({ userId: NOBODY } as never, ctxFor());
    assert.equal(
      (smuggled as { name: string }).name,
      "Test User",
      "模型传进来的 userId 必须被忽略,身份只能来自 channel context",
    );
  });

  it("turns a missing profile into an onboarding ask instead of crashing", async () => {
    // The backend answers 200 with a null body for an unknown user, so a naive
    // client reads `.links` off null and throws a TypeError.
    const result = await getProfile.handler({}, ctxFor({}, NOBODY));
    assert.equal(typeof result, "string");
    assert.match(String(result), /还没有填写资料/);
    assert.match(String(result), /不要编造/);
  });

  it("falls back to the provider actor when the platform user is unresolvable", async () => {
    const result = await getProfile.handler(
      {},
      { thread: {}, user: null, actor: { id: NOBODY }, platform: "slack" } as never,
    );
    assert.match(String(result), /还没有填写资料/);
  });
});

describe("scan_inbox", () => {
  it("strips the backend's keyword score so the model does its own reasoning", async () => {
    const result = (await scanInbox.handler({}, ctxFor())) as Record<string, unknown>[];
    assert.ok(Array.isArray(result) && result.length > 0, "demo 邮箱应该至少有一封机会邮件");

    for (const item of result) {
      assert.equal(item.fitScore, undefined, "fitScore 必须剥掉,否则模型会被正则分数锚定");
      assert.equal(item.category, undefined);
      assert.equal(item.evidence, undefined);
      assert.ok(item.id, "需要 id 才能 prepare_application");
      assert.ok(item.messageId, "需要 messageId 才能 read_message");
    }
  });

  it("reads the raw email body for a message the scan returned", async () => {
    const [first] = (await scanInbox.handler({}, ctxFor())) as { messageId: string }[];
    const message = (await readMessage.handler({ messageId: first!.messageId }, ctxFor())) as {
      subject: string;
      body: string;
    };
    assert.ok(message.subject.length > 0);
    assert.ok(message.body.length > 0, "正文不能是空的,否则模型没有可推理的材料");
  });
});

describe("prepare_application — the approval gate", () => {
  it("asks the human, and changes nothing irreversible when they decline", async () => {
    const [target] = (await scanInbox.handler({}, ctxFor())) as { id: string }[];
    const awaitChoice = mock.fn(async () => false);

    const result = await prepareApplication.handler(
      { opportunityId: target!.id, reason: "匹配你的 AI Agents 兴趣" },
      ctxFor({ awaitChoice }),
    );

    assert.equal(awaitChoice.mock.callCount(), 1, "必须先停下来等人点");
    assert.match(String(result), /没有批准/);
    assert.doesNotMatch(String(result), /已提交/);

    const after = await api<{ status: string }>(`/v1/opportunities/${target!.id}`);
    assert.notEqual(after.status, "SUBMITTED", "拒绝之后不能有任何提交");
    assert.notEqual(after.status, "SENT");
  });

  it("puts a submit and a decline control in front of the human", async () => {
    const [target] = (await scanInbox.handler({}, ctxFor())) as { id: string }[];
    const awaitChoice = mock.fn(async () => false);

    await prepareApplication.handler(
      { opportunityId: target!.id, reason: "匹配你的 FinTech 方向" },
      ctxFor({ awaitChoice }),
    );

    const tree = cardTree(awaitChoice);
    assert.ok(tree.includes("批准并提交"));
    assert.ok(tree.includes("先不要"));
    assert.ok(tree.includes("匹配你的 FinTech 方向"), "理由必须出现在人看到的卡片上");
  });

  it("submits for real once the human approves, and the backend reflects it", async () => {
    const [target] = (await scanInbox.handler({}, ctxFor())) as { id: string }[];
    const awaitChoice = mock.fn(async () => true);

    const result = await prepareApplication.handler(
      { opportunityId: target!.id, reason: "匹配你的 AI Agents 兴趣" },
      ctxFor({ awaitChoice }),
    );

    assert.match(String(result), /已提交/);

    const after = await api<{ status: string }>(`/v1/opportunities/${target!.id}`);
    assert.equal(after.status, "SUBMITTED", "批准之后后端状态必须真的变了");
  });
});
