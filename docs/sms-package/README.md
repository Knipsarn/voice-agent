# 46elks SMS Integration — Drop-in Package

Self-contained Node.js/Express integration for outbound and inbound SMS via 46elks, with GPT-4o-mini contact-info parsing, Firestore session tracking, and a reminder scheduler.

---

## 1. What It Does

This package provides a complete SMS loop for lead follow-up after a phone call:

1. **Post-call outbound SMS** — After a call ends, your system calls `POST /sms/send` with a `tenant_id`, `case_id`, and the customer's phone number. The route sends a configurable message asking the customer to reply with their name, email, and city.
2. **Inbound webhook** — 46elks delivers inbound SMS to `POST /sms/inbound`. The route uses GPT-4o-mini to decide whether the reply contains contact details. If it does, the `cases` Firestore document is updated and a Pipefy sync is triggered. If it does not, one static fallback SMS is sent (and never repeated).
3. **Reminder scheduler** — `POST /sms/reminders/run` is called by a cron job (Cloud Scheduler or similar). It finds active cases that still have no email on file, have not yet received the maximum number of reminders (2), and whose last contact was more than 24 hours ago. It sends reminder 1 or reminder 2 as appropriate.
4. **Dashboard / ops reads** — `GET /sms` lists sessions with filters; `GET /sms/cost-preview` lets a dashboard preview segment count and billing cost before saving a message template.

All messages are configurable per tenant via Firestore (`tenant_settings` collection). Defaults are Swedish and suitable for a legal-services context.

---

## 2. 46elks Setup

### 2.1 Create an account

Sign up at [https://46elks.com](https://46elks.com). A test account gives you a shared number and free credits for development.

### 2.2 Get API credentials

In the 46elks dashboard go to **Account → API credentials**. Copy your **API username** and **API password** — these become `ELK_API_USER` and `ELK_API_PASS`.

### 2.3 Allocate a number

Buy or allocate a dedicated Swedish mobile number (e.g. `+46766xxxxxx`). This becomes `ELK_FROM_NUMBER`. Dedicated numbers guarantee that inbound replies can be routed unambiguously to the correct conversation.

### 2.4 Configure the inbound webhook

In the 46elks dashboard, go to your number's settings and set **SMS URL** to:

```
https://<your-service-hostname>/sms/inbound
```

The route uses `application/x-www-form-urlencoded` — no extra configuration needed on the 46elks side; that is their default POST format.

46elks expects a fast response (< 5 seconds). The route calls `res.status(200).end()` before doing any async work — see the critical note in section 9.

---

## 3. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ELK_API_USER` | Yes | 46elks API username |
| `ELK_API_PASS` | Yes | 46elks API password |
| `ELK_FROM_NUMBER` | Yes | E.164 number purchased from 46elks, e.g. `+46766860841` |
| `OPENAI_API_KEY` | Yes | OpenAI API key — used by GPT-4o-mini contact-info parser |
| `GOOGLE_CLOUD_PROJECT` | Yes (in GCP) | GCP project ID for Firestore; defaults to `ldk-clean` if unset |
| `RESEND_API_KEY` | No | Resend API key — if set, alert emails are sent on lead inquiries and errors |
| `ALERT_FROM_EMAIL` | No | From address for alert emails; default: `Voice Platform <noreply@snmintegrations.se>` |
| `ADMIN_NOTIFICATION_EMAIL` | No | Admin email that receives all alerts; default: `nils.wahlin@snmintegrations.se` |

If `RESEND_API_KEY` is absent, `alert.js` logs a warning and skips sending — the SMS flow continues normally.

---

## 4. Firestore Collections

### 4.1 `sms_sessions`

One document per outbound SMS sent. The inbound webhook looks up the session by matching `(to == customerPhone, from == elkNumber, status == "pending")`.

| Field | Type | Description |
|---|---|---|
| `tenant_id` | string | Identifies which tenant this session belongs to |
| `case_id` | string \| null | Firestore document ID in `cases` collection |
| `from` | string | 46elks number (E.164) |
| `to` | string | Customer phone (E.164) |
| `message_sent` | string | Text of the outbound SMS |
| `segments` | number | Number of SMS segments (billing unit) |
| `elk_message_id` | string | 46elks-assigned message ID |
| `status` | `"pending"` \| `"replied"` \| `"expired"` | Lifecycle state |
| `fallback_sent` | boolean | True after one fallback reply has been sent; no further auto-replies |
| `fallback_type` | `"needs_info"` \| `"already_processed"` | Set when fallback fires |
| `is_reminder` | boolean | True for sessions created by the reminder scheduler |
| `cost_elk_ore` | number | What 46elks charged in Swedish ore (1/100 SEK) |
| `cost_customer_sek` | number | What to bill the tenant: 3.50 SEK × segments |
| `sent_at` | Timestamp | When the outbound SMS was sent |
| `replied_at` | Timestamp | When the customer replied (set on status→replied) |
| `expires_at` | Timestamp | 7 days after `sent_at`; replies after this are ignored |
| `message_reply` | string | Raw inbound SMS text |
| `reply_parsed` | object | GPT-4o-mini output: `{ is_contact_info, name, email, city }` |
| `createdAt` / `updatedAt` | Timestamp | Standard audit fields |

**Composite index required** for the inbound lookup query:

```
Collection: sms_sessions
Fields: to ASC, from ASC, status ASC, sent_at DESC
```

Add this to `firestore.indexes.json` and deploy, or create it in the Firebase console.

### 4.2 `cases`

Represents a lead/customer case. The SMS routes read and write these fields:

| Field | Type | Description |
|---|---|---|
| `tenant_id` | string | Must match the tenant sending reminders |
| `active` | boolean | Only active cases receive reminders |
| `phone` | string | Customer phone number used to send SMS |
| `email` | string | Contact email — presence means "already complete", skips reminders |
| `name` | string | Contact name — written on successful parse |
| `city` | string | Contact city — written on successful parse |
| `reminder_count` | number | How many reminders have been sent; max is 2 |
| `last_reminder` | Timestamp | When the last reminder was sent (used for 24h gap check) |
| `last_call_at` | Timestamp | When the originating call ended (fallback for gap check) |
| `updatedAt` | Timestamp | Updated on every write |

### 4.3 `tenant_settings`

One document per tenant (document ID = `tenant_id`). All fields are optional — defaults are used if absent.

| Field | Type | Description |
|---|---|---|
| `sms_specialist_title` | string | Replaces `[specialist]` in messages, e.g. `"jurist"` |
| `sms_contact_email` | string | Replaces `[contact_email]` in fallback-already-processed message |
| `sms_post_call_message` | string | Post-call outbound message template |
| `sms_fallback_needs_info` | string | Fallback when reply is not contact info and email is unknown |
| `sms_fallback_already_processed` | string | Fallback when reply is not contact info but email is already on file |
| `sms_reminder_1_message` | string | First reminder (24h after initial SMS) |
| `sms_reminder_2_message` | string | Second and final reminder (24h after reminder 1) |

All message templates support two interpolation tokens:
- `[specialist]` — replaced with `sms_specialist_title` (default: `"specialist"`)
- `[contact_email]` — replaced with `sms_contact_email` (default: `"oss"`)

---

## 5. Routes

Mount the router in your Express app:

```js
const smsRouter = require("./routes/sms");
app.use("/sms", authMiddleware, smsRouter);
// Note: /sms/inbound must be exempted from auth — see below.
```

Because `/sms/inbound` receives unauthenticated POST requests from 46elks, exempt it from your auth middleware or mount it separately before the auth guard:

```js
app.post("/sms/inbound", express.urlencoded({ extended: false }), require("./routes/sms-inbound-only"));
// Or selectively skip auth inside your middleware for this path.
```

### Route reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/sms/send` | Required | Send an outbound SMS and create a session |
| `POST` | `/sms/inbound` | None | 46elks inbound webhook |
| `POST` | `/sms/reminders/run` | Required | Run the reminder scheduler (call from Cloud Scheduler) |
| `GET` | `/sms` | Required | List sessions with filters |
| `GET` | `/sms/cost-preview` | Required | Preview segment count and cost for a message string |

#### POST /sms/send

Request body (JSON):

```json
{
  "tenant_id": "enkla-juridik",
  "case_id": "abc123",
  "to": "+46701234567",
  "message": "Optional override — omit to use tenant default"
}
```

Response `201`:

```json
{
  "id": "firestore-doc-id",
  "elk_message_id": "se1a2b3c4d5e6f",
  "segments": 1,
  "cost_elk_ore": 52,
  "cost_customer_sek": 3.50
}
```

#### POST /sms/inbound

Called by 46elks. Form-encoded body fields:

| Field | Description |
|---|---|
| `from` | Customer phone (E.164) |
| `to` | Your 46elks number |
| `message` | SMS text from customer |
| `id` | 46elks message ID |
| `created` | ISO timestamp |

Returns `200` with an empty body immediately. All processing happens asynchronously.

#### POST /sms/reminders/run

Request body (JSON):

```json
{ "tenant_id": "enkla-juridik" }
```

If `tenant_id` is omitted it defaults to `"enkla-juridik"`.

Response `200`:

```json
{
  "scanned": 45,
  "candidates": 3,
  "sent": [{ "case_id": "abc", "phone": "+46701234567" }],
  "failed": []
}
```

#### GET /sms

Query parameters: `tenant_id` (required), `case_id`, `status`, `since` (ISO date), `until` (ISO date), `limit` (default 20, max 1000).

#### GET /sms/cost-preview

Query parameter: `message` (URL-encoded string).

Response:

```json
{
  "segments": 2,
  "cost_customer_sek": 7.00,
  "cost_elk_ore_approx": 104,
  "length": 180
}
```

---

## 6. Contact-Info Parsing Flow (GPT-4o-mini)

When an inbound SMS arrives at `/sms/inbound`:

1. The route ACKs 46elks immediately (`res.status(200).end()`).
2. It looks up the most recent `pending` session for the `(customerPhone, elkNumber)` pair.
3. If no session exists or the session has expired, no action is taken.
4. The message text is sent to GPT-4o-mini with a structured prompt that asks for:
   ```json
   { "is_contact_info": true|false, "name": "...", "email": "...", "city": "..." }
   ```
   The model uses `response_format: { type: "json_object" }` and `temperature: 0` for deterministic output.
5. **If `is_contact_info === true`**: the session is updated to `status: "replied"` and the parsed fields are written back to the `cases` document. A Pipefy sync is triggered (your integration point — replace `syncPipefyForCase` with your CRM call).
6. **If `is_contact_info === false`** and `fallback_sent === false`: a static fallback SMS is sent. The text is chosen based on whether the case already has an email:
   - No email → `fallbackNeedsInfo` (asks customer to try again)
   - Email present → `fallbackAlreadyProcessed` (confirms receipt, gives support contact)
   
   After sending, `fallback_sent` is set to `true`. No further automatic replies are ever sent to this session, regardless of what the customer says next.
7. **If `is_contact_info === false`** and `fallback_sent === true`: the message is silently ignored. The session remains `pending` so the customer can still send their contact details.

The session stays `pending` (not `replied`) after a fallback — the customer can still fix their reply and have their case updated.

---

## 7. Reminder Scheduler

### When to call it

Call `POST /sms/reminders/run` on a schedule during business hours. Example using Google Cloud Scheduler:

```
Schedule:  0 8,10,12,14,16 * * 1-5   (every 2h, Mon–Fri, 08:00–16:00)
Target:    HTTPS
URL:       https://<service>/sms/reminders/run
Body:      {"tenant_id": "your-tenant-id"}
Auth:      OIDC token (or Bearer token matching your API key)
```

Running every 2 hours means a case that becomes eligible at 08:01 will be picked up by 10:00 at the latest — acceptable for a 24h cadence.

### Selection logic

A case is a candidate if ALL of the following are true:

- `tenant_id` matches the request body
- `active === true`
- `email` is absent or empty (still need contact info)
- `reminder_count < 2` (maximum 2 reminders per case)
- The phone number does NOT start with `+4610`, `4610`, or `010` (landlines cannot receive SMS)
- Last contact timestamp (`last_reminder` or `last_call_at`) is more than 24 hours ago. If neither exists, the case is always eligible.

Per run, at most 30 cases are processed (hard cap to limit API spend per invocation).

### Reminder sequence

| `reminder_count` before run | Message sent | `reminder_count` after |
|---|---|---|
| 0 | `reminder1Message` (24h after first contact) | 1 |
| 1 | `reminder2Message` (24h after reminder 1, last attempt) | 2 |
| 2+ | Skipped — exhausted | unchanged |

Each reminder creates a new `sms_sessions` document (with `is_reminder: true`) and updates `reminder_count` and `last_reminder` on the case.

---

## 8. Tenant-Configurable Messages

Store message templates in the `tenant_settings` Firestore collection, document ID = your `tenant_id`.

Example document for `enkla-juridik`:

```json
{
  "sms_specialist_title": "jurist",
  "sms_contact_email": "support@enklajuridik.se",
  "sms_post_call_message": "Hej! Tack för att du kontaktade Enkla Juridik. För att en [specialist] ska kunna kontakta dig, svara med:\nFörnamn Efternamn, din@email.se, Stad",
  "sms_fallback_needs_info": "Det här är enbart för kontaktuppgifter. Svara med ditt namn, e-postadress och ort så att en [specialist] kan kontakta dig.",
  "sms_fallback_already_processed": "Det här är enbart för kontaktuppgifter. Vi har redan tagit emot dina uppgifter och en [specialist] hör av sig inom 48 timmar. Kontakta oss på [contact_email] för frågor och support.",
  "sms_reminder_1_message": "Hej! Vi väntar fortfarande på dina kontaktuppgifter. Svara med:\nNamn, din@email.se, Stad",
  "sms_reminder_2_message": "Sista påminnelse: Svara med ditt namn, e-postadress och stad. Annars hör vi inte av oss."
}
```

Any field can be omitted — the code falls back to hardcoded Swedish defaults. Use `GET /sms/cost-preview?message=<text>` to check segment count before saving a new template.

---

## 9. CRITICAL: Empty Response Body on Inbound Webhook

**Do not change `res.status(200).end()` to `res.send("ok")` or `res.json({...})`.**

46elks has a specific behaviour: if your webhook returns a non-empty response body, 46elks interprets it as an SMS reply to be sent back to the customer. This means `res.send("ok")` would cause 46elks to text "ok" to every customer who replies to your number.

The correct pattern is:

```js
router.post("/inbound", express.urlencoded({ extended: false }), async (req, res) => {
  res.status(200).end();   // ACK first — empty body — before any async work
  // ... rest of handler runs after response is sent
});
```

This also satisfies 46elks' requirement that your endpoint responds within a few seconds — the async Firestore + OpenAI work happens after the ACK.

---

## 10. Cost Tracking Schema

Every `sms_sessions` document records two cost fields:

| Field | Unit | Source | Description |
|---|---|---|---|
| `cost_elk_ore` | Swedish ore (1/100 SEK) | 46elks API response `.cost` ÷ 100 | Actual cost charged by 46elks |
| `cost_customer_sek` | SEK | `3.50 × segments` | Amount to bill the tenant |

**Segment calculation** (`countSegments`):

- If the message contains only characters in the Latin-1 range (U+0000–U+00FF) — which includes Swedish å, ä, ö — GSM-7 encoding applies: 160 chars per single SMS, 153 chars per segment in multipart.
- If the message contains any character outside Latin-1 (emoji, Chinese, etc.) — UCS-2 applies: 70 chars per single SMS, 67 chars per segment in multipart.

The `GET /sms/cost-preview` endpoint applies the same calculation without sending anything, so a dashboard can show a live preview while the user edits a message template.

**Aggregate billing query** — to total costs for a tenant in a date range:

```js
const snap = await db.collection("sms_sessions")
  .where("tenant_id", "==", tenantId)
  .where("sent_at", ">=", startDate)
  .where("sent_at", "<",  endDate)
  .get();

const totalElkOre    = snap.docs.reduce((s, d) => s + (d.data().cost_elk_ore    || 0), 0);
const totalCustomerSek = snap.docs.reduce((s, d) => s + (d.data().cost_customer_sek || 0), 0);
```

---

## 11. Testing Checklist

### Unit / local

- [ ] `countSegments("Hello")` returns `1`
- [ ] `countSegments("å".repeat(160))` returns `1` (exactly at GSM-7 single limit)
- [ ] `countSegments("å".repeat(161))` returns `2`
- [ ] `countSegments("😀".repeat(70))` returns `1` (UCS-2 single limit)
- [ ] `countSegments("😀".repeat(71))` returns `2`
- [ ] `parseContactInfo("Anna Svensson anna@ex.com Stockholm")` returns `{ is_contact_info: true, name: "Anna Svensson", email: "anna@ex.com", city: "Stockholm" }`
- [ ] `parseContactInfo("Hej, när hör ni av er?")` returns `{ is_contact_info: false, ... }`

### Integration (staging / 46elks test account)

- [ ] `POST /sms/send` with a valid Swedish mobile number sends the SMS and creates a Firestore document
- [ ] Replying with contact info triggers the GPT parser, updates `cases`, and sets `status: "replied"`
- [ ] Replying with a question triggers `fallback_sent: true` and you receive the fallback SMS
- [ ] Replying again after a fallback is silently ignored (no second fallback)
- [ ] `POST /sms/reminders/run` with a seeded case sends reminder 1 and increments `reminder_count` to 1
- [ ] Running again immediately does NOT send another reminder (24h gap not met)
- [ ] A case with `reminder_count === 2` is skipped by the scheduler
- [ ] A case with a non-empty `email` field is skipped by the scheduler
- [ ] A case with a phone starting with `+4610` is skipped by the scheduler
- [ ] `GET /sms?tenant_id=<id>` returns the sessions created above
- [ ] `GET /sms/cost-preview?message=Hello` returns `{ segments: 1, cost_customer_sek: 3.5, ... }`

### Production readiness

- [ ] 46elks inbound webhook URL set to `https://<production-host>/sms/inbound`
- [ ] `ELK_API_USER`, `ELK_API_PASS`, `ELK_FROM_NUMBER`, `OPENAI_API_KEY` set in Secret Manager / env
- [ ] Firestore composite index on `sms_sessions` deployed (`to`, `from`, `status`, `sent_at DESC`)
- [ ] Cloud Scheduler job configured for `/sms/reminders/run` during business hours
- [ ] Confirmed that inbound webhook returns `200` with empty body (curl test: `curl -v -d "from=+46700000001&to=<ELK_NUMBER>&message=test&id=test123" https://<host>/sms/inbound` — response body must be empty)
- [ ] Alert emails arrive when a lead sends a non-contact-info reply (requires `RESEND_API_KEY`)

---

## 12. Dependencies

Add to your `package.json`:

```json
{
  "dependencies": {
    "@google-cloud/firestore": "^7.x",
    "express": "^4.x"
  }
}
```

The `https` module is Node.js built-in. No 46elks SDK is used — the integration calls the REST API directly.

`alert.js` uses the global `fetch` (available in Node.js 18+). If you are on Node.js 16, add `node-fetch` and import it.

---

## 13. Integration Points to Adapt

The source file references two platform-specific modules:

- `../lib/pipefy-sync` — exports `syncPipefyForCase(caseId)`. Replace with your CRM sync function. The call is fire-and-forget (`.catch()` handled).
- `../lib/alert` — exports `alertOnLeadInquiry` and `alertOnError`. The alert module is included in this package at `backend/lib/alert.js`. It requires `RESEND_API_KEY` to send emails; it is safe to leave unconfigured (alerts are skipped with a log warning).

If you do not use Pipefy, stub out the import:

```js
// Replace the pipefy-sync require with:
const syncPipefyForCase = async () => {};
```
