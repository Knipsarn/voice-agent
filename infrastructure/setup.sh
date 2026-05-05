#!/bin/bash
# =============================================================================
# AI Voice Platform — Full GCP Infrastructure Setup
# =============================================================================
# Recreates the complete GCP infrastructure from scratch.
# Run this when starting in a new GCP project or after a teardown.
#
# Usage:
#   chmod +x infrastructure/setup.sh
#   ./infrastructure/setup.sh
#
# Prerequisites:
#   - gcloud CLI authenticated: gcloud auth login
#   - Sufficient IAM permissions (Owner or Editor + specific roles)
#   - GitHub repo exists and Cloud Build app installed on it
#
# What this script does NOT do:
#   - Populate secret values (you must add those manually after — see step 3)
#   - Deploy Cloud Run services (Cloud Build triggers handle that on git push)
#   - Create the Firestore database (must be created in the console first)
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT="${PROJECT:-ldk-clean}"
REGION="${REGION:-europe-west1}"
GITHUB_OWNER="${GITHUB_OWNER:-Knipsarn}"
GITHUB_REPO="${GITHUB_REPO:-voice-agent}"

SA_EMAIL="${PROJECT_NUMBER:-360579353014}-compute@developer.gserviceaccount.com"
ERROR_AGENT_SA="error-agent-invoker@${PROJECT}.iam.gserviceaccount.com"
LOG_SINK_SA="service-${PROJECT_NUMBER:-360579353014}@gcp-sa-logging.iam.gserviceaccount.com"

CONTROL_PLANE_URL="https://control-plane-service-360579353014.${REGION}.run.app"
POST_PROCESSOR_URL="https://post-processor-service-360579353014.${REGION}.run.app"
PATCH_AGENT_URL="https://patch-agent-service-360579353014.${REGION}.run.app"
ERROR_AGENT_URL="https://error-agent-service-360579353014.${REGION}.run.app"

echo "=== AI Voice Platform Infrastructure Setup ==="
echo "Project : $PROJECT"
echo "Region  : $REGION"
echo "Repo    : $GITHUB_OWNER/$GITHUB_REPO"
echo ""

# ── Step 1: Enable required APIs ─────────────────────────────────────────────
echo "→ [1/9] Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  logging.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  --project="$PROJECT"
echo "   ✓ APIs enabled"

# ── Step 2: IAM — default service account roles ───────────────────────────────
echo "→ [2/9] Setting IAM roles on default compute service account..."
for ROLE in \
  roles/datastore.user \
  roles/logging.viewer \
  roles/secretmanager.secretAccessor \
  roles/pubsub.publisher; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --quiet
done
echo "   ✓ IAM roles set"

# ── Step 3: Secret Manager — create secrets (values must be added manually) ──
echo "→ [3/9] Creating Secret Manager secrets..."
echo "   NOTE: Secrets are created empty. You must add values after this script."
echo "   Run: gcloud secrets versions add <SECRET_NAME> --data-file=<file>"

SECRETS=(
  ANTHROPIC_API_KEY       # Claude API — patch-agent
  CONTROL_PLANE_API_KEY   # Internal Bearer token — all services to control-plane
  DASHBOARD_CREDENTIALS_EMAIL   # NextAuth admin email (legacy)
  DASHBOARD_CREDENTIALS_PASSWORD
  ELK_API_USER            # 46elks SMS credentials
  ELK_API_PASS
  ELK_FROM_NUMBER         # 46elks sender number e.g. +46766860841
  FORTNOX_CLIENT_ID       # Fortnox OAuth app
  FORTNOX_CLIENT_SECRET
  GITHUB_TOKEN            # GitHub PAT — patch-agent creates PRs and merges
  GOOGLE_CLIENT_ID        # NextAuth Google OAuth
  GOOGLE_CLIENT_SECRET
  NEXTAUTH_SECRET         # NextAuth session secret (random string)
  OPENAI_API_KEY          # OpenAI — voice bridge + post-processor + SMS parser
  RESEND_API_KEY          # Email delivery (optional)
  TELNYX_API_KEY          # Telnyx — voice bridge hangup + transfer
  TELNYX_PUBLIC_KEY       # Telnyx — telephony-service webhook validation
)

for SECRET in "${SECRETS[@]}"; do
  # Skip comment lines
  [[ "$SECRET" == \#* ]] && continue
  if gcloud secrets describe "$SECRET" --project="$PROJECT" &>/dev/null; then
    echo "   ~ $SECRET already exists"
  else
    gcloud secrets create "$SECRET" \
      --project="$PROJECT" \
      --replication-policy="automatic"
    echo "   + $SECRET created (empty)"
  fi
done
echo "   ✓ Secrets created — populate values before deploying services"

# ── Step 4: Pub/Sub — error pipeline topic and subscription ──────────────────
echo "→ [4/9] Creating Pub/Sub topic and subscription..."

if ! gcloud pubsub topics describe voice-platform-errors --project="$PROJECT" &>/dev/null; then
  gcloud pubsub topics create voice-platform-errors --project="$PROJECT"
  echo "   + Topic: voice-platform-errors"
else
  echo "   ~ Topic: voice-platform-errors already exists"
fi

# Service account for Pub/Sub → error-agent OIDC auth
if ! gcloud iam service-accounts describe "$ERROR_AGENT_SA" --project="$PROJECT" &>/dev/null; then
  gcloud iam service-accounts create error-agent-invoker \
    --project="$PROJECT" \
    --display-name="Error Agent Pub/Sub Invoker"
  echo "   + Service account: $ERROR_AGENT_SA"
else
  echo "   ~ Service account: $ERROR_AGENT_SA already exists"
fi

# Grant invoker permission on error-agent Cloud Run service
gcloud run services add-iam-policy-binding error-agent-service \
  --project="$PROJECT" \
  --region="$REGION" \
  --member="serviceAccount:${ERROR_AGENT_SA}" \
  --role="roles/run.invoker" \
  --quiet 2>/dev/null || echo "   ~ (error-agent-service not deployed yet — grant invoker after first deploy)"

# Create push subscription
if ! gcloud pubsub subscriptions describe voice-platform-errors-to-agent --project="$PROJECT" &>/dev/null; then
  gcloud pubsub subscriptions create voice-platform-errors-to-agent \
    --project="$PROJECT" \
    --topic=voice-platform-errors \
    --push-endpoint="${ERROR_AGENT_URL}/" \
    --push-auth-service-account="$ERROR_AGENT_SA" \
    --ack-deadline=60 \
    --message-retention-duration=7d
  echo "   + Subscription: voice-platform-errors-to-agent"
else
  echo "   ~ Subscription: voice-platform-errors-to-agent already exists"
fi
echo "   ✓ Pub/Sub configured"

# ── Step 5: Cloud Logging sink ────────────────────────────────────────────────
echo "→ [5/9] Creating Cloud Logging error sink..."
LOG_FILTER='resource.type=cloud_run_revision AND (resource.labels.service_name=voice-bridge-service OR resource.labels.service_name=control-plane-service OR resource.labels.service_name=telephony-service OR resource.labels.service_name=post-processor-service OR resource.labels.service_name=patch-agent-service OR resource.labels.service_name=error-agent-service) AND severity>=ERROR'

if ! gcloud logging sinks describe error-sink --project="$PROJECT" &>/dev/null; then
  gcloud logging sinks create error-sink \
    "pubsub.googleapis.com/projects/${PROJECT}/topics/voice-platform-errors" \
    --project="$PROJECT" \
    --log-filter="$LOG_FILTER"
  echo "   + Log sink: error-sink"
else
  echo "   ~ Log sink: error-sink already exists"
fi

# Grant log sink writer permission to publish to Pub/Sub
gcloud pubsub topics add-iam-policy-binding voice-platform-errors \
  --project="$PROJECT" \
  --member="serviceAccount:${LOG_SINK_SA}" \
  --role="roles/pubsub.publisher" \
  --quiet
echo "   ✓ Log sink configured"

# ── Step 6: Firestore indexes ─────────────────────────────────────────────────
echo "→ [6/9] Deploying Firestore indexes..."
if [ -f "firestore.indexes.json" ]; then
  firebase deploy --only firestore:indexes --project="$PROJECT" 2>/dev/null || \
    echo "   ! Firebase CLI not found — deploy firestore.indexes.json manually or via Cloud Console"
else
  echo "   ! firestore.indexes.json not found — skipping"
fi
echo "   ✓ Firestore indexes step complete"

# ── Step 7: Cloud Build triggers ─────────────────────────────────────────────
echo "→ [7/9] Cloud Build triggers..."
echo "   NOTE: Cloud Build triggers require the GitHub app to be installed."
echo "   If triggers don't exist, create them in the Cloud Console:"
echo "   Cloud Build → Triggers → Connect Repository → $GITHUB_OWNER/$GITHUB_REPO"
echo ""
echo "   Required triggers (each triggers on push to 'main', uses cloudbuild*.yaml):"
echo "     deploy-voice-bridge   → cloudbuild.yaml"
echo "     deploy-control-plane  → cloudbuild.control-plane.yaml"
echo "     deploy-dashboard      → cloudbuild.dashboard.yaml"
echo "     deploy-telephony      → cloudbuild.telephony.yaml"
echo "   ✓ (manual step if triggers are missing)"

# ── Step 8: Cloud Scheduler jobs ─────────────────────────────────────────────
echo "→ [8/9] Creating Cloud Scheduler jobs..."

# Read API key from Secret Manager for authenticated jobs
CP_API_KEY=$(gcloud secrets versions access latest --secret=CONTROL_PLANE_API_KEY --project="$PROJECT" 2>/dev/null || echo "REPLACE_WITH_API_KEY")

create_scheduler_job() {
  local NAME=$1 SCHEDULE=$2 URI=$3 BODY=$4 TIMEZONE=${5:-Europe/Stockholm} AUTH_HEADER=${6:-}

  if gcloud scheduler jobs describe "$NAME" --project="$PROJECT" --location="$REGION" &>/dev/null; then
    echo "   ~ $NAME already exists"
    return
  fi

  local HEADERS="Content-Type=application/json"
  if [ -n "$AUTH_HEADER" ]; then
    HEADERS="${HEADERS},Authorization=Bearer ${AUTH_HEADER}"
  fi

  gcloud scheduler jobs create http "$NAME" \
    --project="$PROJECT" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --uri="$URI" \
    --message-body="$BODY" \
    --headers="$HEADERS" \
    --time-zone="$TIMEZONE" \
    --attempt-deadline=120s
  echo "   + $NAME"
}

# Post-processor: every minute, no auth (Cloud Run is allow-unauthenticated)
create_scheduler_job \
  "post-processor-pending" \
  "* * * * *" \
  "${POST_PROCESSOR_URL}/process-pending" \
  '{"limit":50}' \
  "UTC"

# SMS reminders: every 2h during business hours
create_scheduler_job \
  "enkla-juridik-sms-reminders" \
  "30 7-19/2 * * *" \
  "${CONTROL_PLANE_URL}/sms/reminders/run" \
  '{"tenant_id":"enkla-juridik"}' \
  "Europe/Stockholm" \
  "$CP_API_KEY"

# Pipefy auto-sync: every 4 hours
create_scheduler_job \
  "pipefy-auto-sync" \
  "0 */4 * * *" \
  "${CONTROL_PLANE_URL}/pipefy/auto-sync" \
  "{}" \
  "Europe/Stockholm" \
  "$CP_API_KEY"

# Prompt suggestion processor: every 2h during business hours
create_scheduler_job \
  "prompt-suggestion-processor" \
  "0 8-20/2 * * *" \
  "${PATCH_AGENT_URL}/process-suggestions" \
  "{}" \
  "Europe/Stockholm"

echo "   ✓ Cloud Scheduler jobs configured"

# ── Step 9: Summary ───────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Populate secrets in Secret Manager:"
echo "   gcloud secrets versions add OPENAI_API_KEY --data-file=<file>"
echo "   gcloud secrets versions add ANTHROPIC_API_KEY --data-file=<file>"
echo "   gcloud secrets versions add CONTROL_PLANE_API_KEY --data-file=<file>"
echo "   gcloud secrets versions add TELNYX_API_KEY --data-file=<file>"
echo "   gcloud secrets versions add TELNYX_PUBLIC_KEY --data-file=<file>"
echo "   gcloud secrets versions add GITHUB_TOKEN --data-file=<file>"
echo "   gcloud secrets versions add ELK_API_USER --data-file=<file>"
echo "   gcloud secrets versions add ELK_API_PASS --data-file=<file>"
echo "   gcloud secrets versions add ELK_FROM_NUMBER --data-file=<file>"
echo "   gcloud secrets versions add GOOGLE_CLIENT_ID --data-file=<file>"
echo "   gcloud secrets versions add GOOGLE_CLIENT_SECRET --data-file=<file>"
echo "   gcloud secrets versions add NEXTAUTH_SECRET --data-file=<file>"
echo "   gcloud secrets versions add FORTNOX_CLIENT_ID --data-file=<file>"
echo "   gcloud secrets versions add FORTNOX_CLIENT_SECRET --data-file=<file>"
echo ""
echo "2. Create Firestore database (if new project):"
echo "   Cloud Console → Firestore → Create database → Native mode → $REGION"
echo ""
echo "3. Connect GitHub repo to Cloud Build and create triggers (if missing):"
echo "   Cloud Console → Cloud Build → Triggers → Connect Repository"
echo ""
echo "4. Push to main to trigger first deploy:"
echo "   git push origin main"
echo ""
echo "5. After error-agent-service is deployed, grant Pub/Sub invoker:"
echo "   gcloud run services add-iam-policy-binding error-agent-service \\"
echo "     --region=$REGION --project=$PROJECT \\"
echo "     --member=serviceAccount:${ERROR_AGENT_SA} \\"
echo "     --role=roles/run.invoker"
