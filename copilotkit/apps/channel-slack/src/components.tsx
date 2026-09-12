/**
 * Agent-rendered components for the on-call agent.
 *
 * `defineChannelComponent` turns a component into a tool the agent can call to
 * draw UI itself. This is rung 3 of the Context Ladder: at 2am nobody reads a
 * paragraph, but everyone reads a card.
 *
 * One tree renders as Slack Block Kit, Teams Adaptive Cards, and Discord
 * components. A surface that cannot render a node skips it rather than failing.
 */
import {
  defineChannelComponent,
  Message,
  Header,
  Section,
  Markdown,
  Fields,
  Field,
  Context,
  Divider,
  Actions,
  Button,
  Table,
  Row,
  Cell,
} from "@copilotkit/channels";
import { z } from "zod";

/** Severity drives the colour rail, so the channel can triage by glance. */
const SEVERITY = {
  sev1: { accent: "#C4145F", label: "SEV1 · customer-facing" },
  sev2: { accent: "#8A5C10", label: "SEV2 · degraded" },
  sev3: { accent: "#5B6478", label: "SEV3 · internal" },
  resolved: { accent: "#2E7D5B", label: "RESOLVED" },
} as const;

/**
 * The state of the incident, as one glanceable card.
 *
 * Deliberately has no "what happened" prose field. The thread is the narrative;
 * this is the summary a person joining at minute 40 needs.
 */
export const IncidentCard = defineChannelComponent({
  name: "incident_card",
  description:
    "Draw the current state of the incident as a card: severity, what is affected, what is known, and what is being tried. Call this once you have read the thread, and call it again when the picture changes. Prefer it over describing the incident in prose.",
  parameters: z.object({
    severity: z.enum(["sev1", "sev2", "sev3", "resolved"]),
    headline: z.string().describe("What is broken, in under ten words."),
    impact: z.string().describe("Who or what is affected, concretely."),
    started: z.string().describe("When it started, as stated in the thread. 'unknown' is a valid answer."),
    known: z.array(z.string()).max(4).default([]).describe("What the thread has established."),
    trying: z.array(z.string()).max(3).default([]).describe("What is currently being attempted."),
    owner: z.string().optional().describe("Who is driving, if the thread says."),
  }),
  render({ severity, headline, impact, started, known, trying, owner }) {
    const sev = SEVERITY[severity];
    return (
      <Message accent={sev.accent}>
        <Header>{headline}</Header>
        <Context>{sev.label}</Context>
        <Fields>
          <Field label="Impact">{impact}</Field>
          <Field label="Started">{started}</Field>
          {owner && <Field label="Driving">{owner}</Field>}
        </Fields>
        {known.length > 0 && (
          <Section>
            <Markdown>{`*What we know*\n${known.map((k) => `• ${k}`).join("\n")}`}</Markdown>
          </Section>
        )}
        {trying.length > 0 && (
          <Section>
            <Markdown>{`*Being tried*\n${trying.map((t) => `• ${t}`).join("\n")}`}</Markdown>
          </Section>
        )}
      </Message>
    );
  },
});

/**
 * The incident timeline. Handover and the postmortem both run on this, which is
 * why it is worth keeping in the thread rather than someone's notes app.
 */
export const Timeline = defineChannelComponent({
  name: "timeline",
  description:
    "Draw an ordered timeline of what happened when. Call this when there are three or more events worth ordering — it is what on-call handover and the postmortem are written from.",
  parameters: z.object({
    title: z.string().default("Timeline"),
    events: z
      .array(
        z.object({
          at: z.string().describe("Time as the thread states it, e.g. '02:14' or '~20m ago'."),
          what: z.string().describe("What happened, in one line."),
          who: z.string().optional(),
        }),
      )
      .min(1)
      .max(12),
  }),
  render({ title, events }) {
    return (
      <Message>
        <Header>{title}</Header>
        <Table
          columns={[{ header: "When" }, { header: "What" }, { header: "Who" }]}
        >
          {events.map((event) => (
            <Row>
              <Cell>{event.at}</Cell>
              <Cell>{event.what}</Cell>
              <Cell>{event.who ?? "—"}</Cell>
            </Row>
          ))}
        </Table>
        <Divider />
        <Context>{`${events.length} event(s) · newest last`}</Context>
      </Message>
    );
  },
});

/**
 * The welcome message. A bot that says nothing when invited looks broken; one
 * that says what it will do on its own gets used.
 */
export function welcomeMessage(platform: string) {
  return (
    <Message accent="#C4145F">
      <Header>On-call assistant, in the thread</Header>
      <Section>
        <Markdown>
          {"When something breaks, @-mention me. I read what has already been said in this " +
            platform +
            " thread first — you should never have to re-explain an outage to me."}
        </Markdown>
      </Section>
      <Fields>
        <Field label="I will">Summarise, keep a timeline, look things up</Field>
        <Field label="I won't">Touch production without a click</Field>
      </Fields>
      <Actions>
        <Button
          value="catchup"
          style="primary"
          onClick={async ({ thread }) => {
            await thread.runAgent({
              prompt:
                "Read this thread and bring me up to speed on the incident. Draw the incident card.",
            });
          }}
        >
          Catch me up
        </Button>
      </Actions>
    </Message>
  );
}

/** Verdict drives the colour rail, so the thread can be triaged at a glance. */
const VERDICT = {
  high: { accent: "#2E7D5B", label: "值得参加" },
  medium: { accent: "#8A5C10", label: "可以看看" },
  low: { accent: "#5B6478", label: "不太合适" },
} as const;

/**
 * One opportunity, judged, as a card.
 *
 * Every field here is the AGENT's conclusion, passed in as arguments — not the
 * backend's keyword score. That is the point: the card is evidence that the
 * agent read this person's profile and this email, not that a regex matched.
 *
 * The button is the demo beat. It re-enters the agent, which then calls
 * prepare_application and blocks on the approval gate.
 */
export const OpportunityCard = defineChannelComponent({
  name: "opportunity_card",
  description:
    "把一个机会的判断结果画成卡片:结论、截止时间、为什么匹配、要权衡什么。判断完一个机会就画它,优先于用散文描述。reasons 每一条都必须来自 get_profile 的真实资料或邮件正文,不能是泛泛而谈。",
  parameters: z.object({
    opportunityId: z.string().describe("机会的 id。"),
    title: z.string().describe("机会名称。"),
    verdict: z.enum(["high", "medium", "low"]).describe("你的判断:值得参加 / 可以看看 / 不太合适。"),
    deadline: z.string().describe("截止时间,按邮件原文。说不清楚就写 unknown。"),
    reasons: z
      .array(z.string())
      .min(1)
      .max(4)
      .describe("为什么匹配。每条要具体到用户的某项资料或邮件里的某个要求。"),
    tradeoff: z
      .string()
      .optional()
      .describe("需要权衡的地方:时间冲突、缺少某项要求、信息不全。没有就省略。"),
  }),
  render({ opportunityId, title, verdict, deadline, reasons, tradeoff }) {
    const v = VERDICT[verdict];
    return (
      <Message accent={v.accent}>
        <Header>{title}</Header>
        <Context>{`${v.label} · 截止 ${deadline}`}</Context>
        <Section>
          <Markdown>{`*为什么*\n${reasons.map((r) => `• ${r}`).join("\n")}`}</Markdown>
        </Section>
        {tradeoff && (
          <Section>
            <Markdown>{`*要权衡*\n${tradeoff}`}</Markdown>
          </Section>
        )}
        <Actions>
          <Button
            value="prepare"
            style="primary"
            onClick={async ({ thread }) => {
              await thread.runAgent({
                prompt: `为这个机会准备申请材料:${title}(id: ${opportunityId})。先调 prepare_application。`,
              });
            }}
          >
            准备申请
          </Button>
        </Actions>
      </Message>
    );
  },
});
