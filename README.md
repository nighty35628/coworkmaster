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

Set `DEMO_MODE=false` and replace `MockMailboxAdapter` in
`src/services/mailbox.ts` with an IMAP/SMTP adapter when connecting a real
mailbox. Put DeepSeek credentials in the server environment only; the API
falls back to deterministic classification when no key is configured.

Important routes include `POST /v1/profile`, `POST /v1/scan`,
`POST /v1/opportunities/:id/prepare-form`,
`POST /v1/opportunities/:id/approve`, `POST /v1/opportunities/:id/submit`,
and `POST /v1/feedback/events`.
