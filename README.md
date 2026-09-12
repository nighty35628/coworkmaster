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

Open [http://localhost:8787/](http://localhost:8787/) for the local test
console. It supports IMAP/SMTP connection testing, reading messages, profile
editing, opportunity scanning, form preparation, approval, simulated sending,
and feedback. In demo mode the seeded mailbox works without credentials.

Run the Slack adapter in a second terminal after the API is up:

```bash
npm run slack
```

Without Slack credentials it stays in mock mode. With Socket Mode, set
`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_APP_TOKEN`; the Slack
app then uses the same HTTP API and supports `/whenagent profile`, `scan`,
`inbox`, and approval modals.

Set `DEMO_MODE=false` and replace `MockMailboxAdapter` in
`src/services/mailbox.ts` with an IMAP/SMTP adapter when connecting a real
mailbox. Put DeepSeek credentials in the server environment only; the API
falls back to deterministic classification when no key is configured.

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

The browser polls `GET /v1/demo/sessions/:id` and redirects from
`signin.html` to `profile.html`, then to `success.html`. The registration ID
is deterministic for a session (`HK-DEMO-XXXXXX`), which keeps a live demo
repeatable. Opening `hackathon/index.html` still provides the standalone
one-page form.
