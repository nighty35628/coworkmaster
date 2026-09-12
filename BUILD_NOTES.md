# Opportunity Autopilot in Slack

## Build scope

This repository is a new, backend-first hackathon build. Slack is the product
interface. A small local setup page or Swagger UI is only for testing an IMAP
and SMTP connection during development.

## MVP vertical slice

1. Connect one test mailbox and read one or more unread messages.
2. Ask DeepSeek for structured opportunity data: deadline, action, fit reasons,
   and a proposed reply.
3. Send the opportunity to Slack as a Block Kit card in a thread.
4. Open a review modal and wait for an explicit approval.
5. Re-read the source message, send through SMTP, and update the Slack thread.

## Key product features

- **Profile in Slack:** a DM wizard collects a small structured profile (name,
  school, program, skills, project links, and short bio). The profile is used
  as context for classification and opportunity fit; it is never sent to a
  channel unless the user asks.
- **Actionable form preparation:** when an opportunity contains a registration
  URL, the Agent extracts the form fields and prepares answers from the
  profile. The first demo supports one controlled HTML form fixture (with
  generic label matching as a fallback). It fills a browser session but never
  submits before Slack approval.
- **Useful classification:** every message receives a small set of labels such
  as `opportunity`, `action_required`, `academic`, `transactional`,
  `newsletter`, or `low_priority`, plus urgency and deadline. Only actionable
  opportunities trigger the approval flow.

The shared object passed between services is an `ActionPackage`: source email,
classification, evidence, fit reasons, prepared form answers, draft reply,
calendar artifact, and an approval state. This keeps the Slack adapter thin and
allows each step to be tested over HTTP.

## Deliberate cuts

No multi-account support, full mailbox UI, folder/search synchronization,
complex rich-text editing, or calendar-provider integration in the event MVP.
Calendar output is an `.ics` artifact. A local mock mailbox and seeded message
or a controlled registration form are valid fallbacks if live services are
unavailable.

## Initial API contract

- `GET /v1/health`
- `POST /v1/accounts/test`
- `POST /v1/scan`
- `GET /v1/opportunities/:id`
- `POST /v1/opportunities/:id/prepare`
- `POST /v1/opportunities/:id/decision`
- `POST /v1/profile`
- `GET /v1/profile`
- `POST /v1/opportunities/:id/form/prepare`

The Slack adapter must call the same application services as the HTTP API.
Business logic must not depend on Slack payloads.

## Hackathon provenance

The Agent workflow, Slack interaction, data model, and integrations in this
repository are to be built during the official hackathon. Third-party protocol
libraries and the CopilotKit starter are infrastructure, not submitted product
features.
