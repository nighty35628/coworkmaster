import { createChannel } from "@copilotkit/channels";
import { makeAgent, isSearchConfigured, isWorkplaceConfigured, WORKPLACE_CONTEXT } from "agent-core";
import { required } from "./env";
import { OpportunityCard, welcomeMessage } from "./components";
import { readThread, searchTheWeb } from "./tools";
import {
  getProfile,
  scanInbox,
  readMessage,
  prepareApplication,
  rejectOpportunity,
} from "./opportunity-tools";

// Tools are registered only when their credential is present, so the agent is
// never handed a tool that will fail when it calls it.
//
// The on-call demo's propose_action is deliberately absent: this agent has one
// approval gate, inside prepare_application, and a second unrelated one would
// make it ambiguous which gate a submission actually passed through.
const tools = [
  readThread,
  getProfile,
  scanInbox,
  readMessage,
  prepareApplication,
  rejectOpportunity,
  ...(isSearchConfigured() ? [searchTheWeb] : []),
];

export const channel = createChannel({
  // Must equal the Channel Code in Intelligence, character for character. A
  // mismatch leaves the Channel at "Waiting for runtime" and is validated at
  // startup, not here.
  name: required("CHANNEL_CODE"),

  // Required. "platform" derives the canonical user from provider + workspace +
  // platform user id. Do NOT move this onto CopilotRuntime — that one is for
  // web requests and must be absent on a Channels-only runtime.
  identifyUser: "platform",

  agent: makeAgent,
  tools,
  components: [OpportunityCard],

  // Injected into the agent's prompt on every run.
  context: [
    {
      description: "Backend",
      value:
        "用户的资料、邮箱、机会和审批状态都在后端。判断一个机会是否值得参加之前,必须先调 get_profile 拿到真实资料,调 scan_inbox 拿到线索,并用 read_message 读邮件正文。没有调过 get_profile 就不要对用户的任何背景下结论。资料为空时引导他先去填,不要编造。",
    },
    {
      description: "Rendering",
      value:
        "You can draw native UI by calling opportunity_card. Prefer it over prose whenever the answer has structure.",
    },
    ...(isWorkplaceConfigured()
      ? [{ description: "Workplace", value: WORKPLACE_CONTEXT }]
      : []),
    {
      description: "Surface",
      value:
        "This is a chat thread in a channel people are actively working in. Assume others are reading and that some joined late.",
    },
  ],

  // Managed Slack hides tool-call progress by default. Turning it on is worth it
  // in a demo — the audience watches the agent search and think.
  showToolStatus: true,
});

// A mention subscribes the conversation, so the agent then follows along instead
// of needing to be @-mentioned every single turn.
channel.onMention(async ({ thread }) => {
  await thread.subscribe();
  await thread.runAgent();
});

// Non-mentioned turns only ever reach onMessage — gate them on the flag or the
// agent will answer every message in every channel it has been invited to.
channel.onMessage(async ({ thread }) => {
  if (await thread.isSubscribed()) {
    await thread.runAgent();
  }
});

channel.onWelcome(async ({ thread, platform }) => {
  await thread.post(welcomeMessage(platform));
});
