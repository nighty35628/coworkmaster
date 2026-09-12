# Opportunity Autopilot backend

API-first backend for the Agents, Everywhere hackathon. Slack is the intended
interface; this service exposes profile, mailbox, classification, form draft,
approval and feedback APIs. It runs in demo mode with seeded messages, so the
vertical slice can be tested without credentials.

```bash
npm install
cp .env.example .env
npm run dev
curl http://localhost:8787/v1/health
```

For a local console that keeps running after the terminal task ends, use
`npm run start:background` instead of `npm run dev`. Logs and the process ID
are written to `.data/server.log` and `.data/server.pid`. The server listens
on `127.0.0.1:8787` by default.

The background server also polls the configured mailbox for new unread mail.
Set `MAIL_POLL_INTERVAL_MS` to change the interval (default 15 seconds). A
message containing the exact keyword `AIAGENTHACKTHON` creates a registration
demo session, fills it from the saved profile, and opens the local browser at
the hackathon sign-in page. Set `OPEN_DEMO_BROWSER=false` when running on a
headless machine; the URL is still logged in `.data/server.log`.

Open [http://localhost:8787/](http://localhost:8787/) for the local test
console. It supports IMAP/SMTP connection testing, reading messages, profile
editing, opportunity scanning, form preparation, approval, simulated sending,
and feedback. In demo mode the seeded mailbox works without credentials.

Run the Slack adapter in a second terminal after the API is up:

```bash
npm run slack
```

Without Slack credentials it stays in mock mode. With Socket Mode, set
`SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`; `SLACK_SIGNING_SECRET` is optional
for this WebSocket transport (it is only needed if you later expose Slack's
HTTP receiver). The Slack app then uses the same HTTP API and supports
`/whenagent profile`, `scan`, `inbox`, and approval modals.

To connect a real mailbox, enter its IMAP/SMTP settings in the console and
click **连接并保存**. Both connections are verified before saving. The current
single-account backend stores credentials in `.data/mailbox.json` with
owner-only file permissions; `.data/` is excluded from Git. The server restores
this account after a restart, and the console refills the server settings.
Leave the password blank to reuse the saved credentials for the same account.
The status API never returns passwords. Without a saved account, the backend
uses the seeded demo mailbox.

`POST /v1/accounts/test` verifies a configuration without saving it;
`POST /v1/accounts/connect` verifies and saves it. Both accept an empty JSON
object to reuse the saved configuration. `GET /v1/accounts/status` reports
the saved settings and the most recent connect result for this server run.
Put DeepSeek credentials in the server environment only; the API falls back
to deterministic classification when no key is configured.

`src/services/forms.ts` defines the `FormAdapter` contract. The demo uses
prepared fields only; a Playwright adapter can be added later without changing
Slack handlers or the opportunity state machine.

Important routes include `POST /v1/profile`, `POST /v1/scan`,
`POST /v1/opportunities/:id/prepare-form`,
`POST /v1/opportunities/:id/approve`, `POST /v1/opportunities/:id/submit`,
and `POST /v1/feedback/events`.

## Hackathon registration demo

The four pages from `hackathon-registration-sandbox.zip` are served under
`/hackathon/`. They support a trigger-only presentation flow: the agent calls
the demo API while an open browser observes the session and moves through the
pages.

```bash
# 1. Create a session and open the returned displayUrl in a browser
curl -X POST http://localhost:8787/v1/demo/sessions \
  -H 'content-type: application/json' \
  -d '{"email":"demo@example.com"}'

# 2. Use the returned sessionId for each trigger
curl -X POST http://localhost:8787/v1/demo/trigger/login \
  -H 'content-type: application/json' \
  -d '{"sessionId":"SESSION_ID","email":"demo@example.com"}'

curl -X POST http://localhost:8787/v1/demo/trigger/fill-profile \
  -H 'content-type: application/json' \
  -d '{"sessionId":"SESSION_ID","profile":{"firstName":"Alex","lastName":"Chen","companyName":"Demo Labs","jobTitle":"AI Engineer","biography":"Builds useful agents.","currentProjects":"Hackathon sandbox","skills":"TypeScript, Python","areasOfInterest":"AI agents","introPreference":"open","contactPreference":"email","role":"aiEngineer"}}'

curl -X POST http://localhost:8787/v1/demo/trigger/submit \
  -H 'content-type: application/json' \
  -d '{"sessionId":"SESSION_ID"}'
```

The intended live-demo order is: simulate the invitation email, create a
session, open the returned `displayUrl`, then let the agent call `login` and
`fill-profile`. The browser polls `GET /v1/demo/sessions/:id`, moves from
`signin.html` to `profile.html`, and renders the agent-filled values. The
browser never submits automatically: the person reviews the form and clicks
**Review and Submit Application**, which is the human approval boundary and
then calls `submit`. The final page is `success.html` and shows a deterministic
registration ID (`HK-DEMO-XXXXXX`) for repeatable stage demos. Opening
`hackathon/index.html` still provides the standalone one-page form.
