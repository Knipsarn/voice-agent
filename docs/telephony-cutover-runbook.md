# Telephony cutover runbook (Phase A)

Goal: replace n8n in the inbound call path with `telephony-service`. One number at a time, fully reversible.

## Prerequisites

Already done:
- `voice-platform-shared` Call Control App created in Telnyx (ID `2946878804032751101`, webhook `https://telephony-service-360579353014.europe-west1.run.app/webhooks/telnyx`)
- `apps/telephony/` source written and syntax-checked
- `Dockerfile.telephony` and `cloudbuild.telephony.yaml` written

Still to do before first cutover:
1. Add `TELNYX_PUBLIC_KEY` to Secret Manager
2. Create the Cloud Build trigger that watches `cloudbuild.telephony.yaml`
3. First deploy (manual via `gcloud builds submit` or wait for trigger)
4. Smoke test the deployed `/health`
5. Write the first `phone_numbers` Firestore doc
6. Re-attach one number from its old per-tenant app to `voice-platform-shared`
7. Test call

---

## Step 1 — Add TELNYX_PUBLIC_KEY to Secret Manager

The current value in `config/.env` is local-only. Cloud Run reads it from Secret Manager via `--update-secrets` in `cloudbuild.telephony.yaml`.

```bash
# Write to a temp file (avoid Windows echo \r\n contaminating the secret)
node -e "require('fs').writeFileSync('k.tmp', 'ZpgnVm6gfjiC4rSVR7LEHs+fscCLyZwft0S7+/X5sv8=')"
gcloud secrets create TELNYX_PUBLIC_KEY --replication-policy=automatic --project=ldk-clean
gcloud secrets versions add TELNYX_PUBLIC_KEY --data-file=k.tmp --project=ldk-clean
del k.tmp

# Grant the runtime service account access
gcloud secrets add-iam-policy-binding TELNYX_PUBLIC_KEY \
  --member='serviceAccount:360579353014-compute@developer.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor' \
  --project=ldk-clean
```

Verify:
```bash
gcloud secrets versions access latest --secret=TELNYX_PUBLIC_KEY --project=ldk-clean
# expect the base64 string with no trailing newline
```

## Step 2 — Create the Cloud Build trigger

In GCP Console → Cloud Build → Triggers → Create Trigger:
- Name: `telephony-service-deploy`
- Event: Push to a branch
- Repo: `Knipsarn/voice-agent`
- Branch: `^main$`
- Configuration: Cloud Build configuration file
- File location: `cloudbuild.telephony.yaml`
- Included files filter: `apps/telephony/**`, `Dockerfile.telephony`, `cloudbuild.telephony.yaml`

Or via gcloud (one-shot, idempotent):
```bash
gcloud builds triggers create github \
  --repo-name=voice-agent \
  --repo-owner=Knipsarn \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.telephony.yaml \
  --included-files="apps/telephony/**,Dockerfile.telephony,cloudbuild.telephony.yaml" \
  --name=telephony-service-deploy \
  --project=ldk-clean
```

## Step 3 — First deploy

Either commit + push (trigger fires) or one-shot manual:
```bash
gcloud builds submit \
  --config=cloudbuild.telephony.yaml \
  --project=ldk-clean
```

## Step 4 — Smoke test

```bash
curl https://telephony-service-360579353014.europe-west1.run.app/health
```
Expected:
```json
{
  "status": "ok",
  "service": "telephony",
  "project": "ldk-clean",
  "has_telnyx_api_key": true,
  "has_telnyx_public_key": true,
  "bridge_url": "https://voice-bridge-service-360579353014.europe-west1.run.app/"
}
```

Any `false` for the keys → deploy didn't pick up Secret Manager. Check the run config in GCP Console.

## Step 5 — Write the phone_numbers Firestore doc (first cutover: alvsjo-tandvard)

Run from a machine with `gcloud auth application-default login` already done. Either via gcloud or a tiny Node script:

```bash
gcloud firestore documents write \
  --project=ldk-clean \
  --collection=phone_numbers \
  --document=+46105201311 \
  --data='{
    "tenant_id": "alvsjo-tandvard",
    "provider": "telnyx",
    "provider_number_id": "2784931579334493615",
    "call_control_app_id": "2946878804032751101",
    "capabilities": {"voice": true, "sms": false, "outbound": false},
    "status": "active",
    "assigned_at": "2026-04-27T00:00:00Z"
  }'
```

(If the gcloud sub-command doesn't exist on your version, use the Firestore console UI or a small Node script that calls `Firestore.doc('phone_numbers/+46105201311').set({...})`.)

## Step 6 — Re-attach the number to the shared app

This is the actual cutover moment. Once this completes, the next call to `+46105201311` hits `telephony-service` instead of n8n.

```bash
TELNYX_API_KEY="<from .env>"
NUMBER_ID="2784931579334493615"   # +46105201311
NEW_APP_ID="2946878804032751101"  # voice-platform-shared

curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/${NUMBER_ID}/voice" \
  -H "Authorization: Bearer ${TELNYX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"connection_id\": \"${NEW_APP_ID}\"}"
```

Verify:
```bash
curl -H "Authorization: Bearer ${TELNYX_API_KEY}" \
  "https://api.telnyx.com/v2/phone_numbers/${NUMBER_ID}" | python -c "import json,sys; d=json.load(sys.stdin)['data']; print(d['phone_number'], '->', d['connection_name'], d['connection_id'])"
```
Expected: `+46105201311 -> voice-platform-shared 2946878804032751101`

## Step 7 — Test call

Call `+46105201311` from a phone. Watch logs in parallel:

```bash
# Telephony service: did the webhook arrive, signature verify, lookup hit, answer fire?
gcloud run services logs read telephony-service --region=europe-west1 --project=ldk-clean --limit=50

# Bridge: did the WSS connect with the right tenant?
gcloud run services logs read voice-bridge-service --region=europe-west1 --project=ldk-clean --limit=50
```

Expect this sequence in `telephony-service` logs:
1. `webhook_event_ignored` for any pre-init events (or none)
2. `call_routed` with `tenant_id: alvsjo-tandvard`, `to: +46105201311`
3. `telnyx_answer_sent` with `status: 200`
4. Eventually `call_end` with `hangup_cause`

Expect in `voice-bridge-service` logs:
1. `call_start` with `tenant_id: alvsjo-tandvard`
2. `openai_ready`, `first_message`, normal call lifecycle

## Rollback (if anything goes wrong)

A single API call points the number back at the old per-tenant app:

```bash
# alvsjo old app
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/2784931579334493615/voice" \
  -H "Authorization: Bearer ${TELNYX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "2917849237788034114"}'

# enkla old app (if cut over)
# connection_id: 2901883334340642796
```

The old per-tenant apps stay live with their n8n webhooks until both numbers are cut over and stable.

## Step 8 — Cut over enkla-juridik

Repeat steps 5–7 for `+46105201287`:
- Firestore doc: `phone_numbers/+46105201287` with `tenant_id: enkla-juridik`, `provider_number_id: 2782728428716033309`
- Re-attach to app `2946878804032751101`
- Test call

## When both tenants are stable

- Optionally cut over the test number `+46105201310` too
- Delete (or mark inactive) the per-tenant Call Control Apps:
  - `2917849237788034114` alvsjo_tandvård
  - `2906106493952591401` enkla_juridik.tst
  - `2901883334340642796` enkla_juridik
- Decommission the n8n webhook flows
- Update `CLAUDE.md` "n8n WSS URL format" section to note the new path is via telephony-service

---

## Reference: number → connection mapping at start of cutover

| Number | Telnyx number ID | Currently on conn | Target conn |
|---|---|---|---|
| +46105201311 (alvsjo) | 2784931579334493615 | 2917849237788034114 | 2946878804032751101 |
| +46105201287 (enkla) | 2782728428716033309 | 2901883334340642796 | 2946878804032751101 |
| +46105201310 (enkla.tst) | 2784931579292550574 | 2906106493952591401 | 2946878804032751101 |
