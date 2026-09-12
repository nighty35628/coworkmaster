import { HttpAgentApi, startSlackApp } from "./slack/index.js";

const apiBaseUrl = process.env.AGENT_API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;

await startSlackApp({
  api: new HttpAgentApi(apiBaseUrl),
  botToken: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  mock: process.env.SLACK_MOCK === "true",
});
