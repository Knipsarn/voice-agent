#!/usr/bin/env bash
# scripts/setup/operator-sa.sh
#
# One-time setup: create dedicated operator service account, grant minimal
# IAM roles needed for ops scripts + AI agent tasks, generate JSON key, store
# locally + Secret Manager.
#
# Run this ONCE with your personal gcloud auth. After this, run
# scripts/ops/auth.sh whenever your personal gcloud expires — that switches
# gcloud to the operator SA which never expires.
#
# Usage:
#   bash scripts/setup/operator-sa.sh

set -euo pipefail

PROJECT="ldk-clean"
SA_NAME="voice-platform-operator"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
KEY_PATH="config/operator-sa.json"

ROLES=(
  "roles/datastore.user"
  "roles/logging.viewer"
  "roles/logging.logWriter"
  "roles/secretmanager.secretAccessor"
  "roles/secretmanager.secretVersionAdder"
  "roles/run.developer"
  "roles/cloudbuild.builds.editor"
  "roles/storage.objectViewer"
  "roles/iam.serviceAccountUser"
  "roles/pubsub.editor"
)

echo "→ Verifying gcloud auth (your personal account)…"
ACTIVE=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" --project=${PROJECT} 2>/dev/null | head -1 || true)
if [ -z "$ACTIVE" ]; then
  echo "❌ No active gcloud account. Run: gcloud auth login"
  exit 1
fi
echo "  active: ${ACTIVE}"

# 1. Create SA if missing
echo "→ Creating service account ${SA_EMAIL}…"
if gcloud iam service-accounts describe "${SA_EMAIL}" --project=${PROJECT} >/dev/null 2>&1; then
  echo "  exists, skipping create"
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --project=${PROJECT} \
    --display-name="Voice Platform Operator" \
    --description="Long-lived ops account for AI / Claude Code"
  echo "  created"
fi

# 2. Grant roles
echo "→ Granting IAM roles…"
for role in "${ROLES[@]}"; do
  echo "  · ${role}"
  gcloud projects add-iam-policy-binding ${PROJECT} \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --quiet >/dev/null
done

# 3. Generate key (only if local key file missing)
if [ -f "${KEY_PATH}" ]; then
  echo "→ Local key exists at ${KEY_PATH}, skipping new key generation"
else
  echo "→ Generating JSON key → ${KEY_PATH}…"
  mkdir -p "$(dirname "${KEY_PATH}")"
  gcloud iam service-accounts keys create "${KEY_PATH}" \
    --iam-account="${SA_EMAIL}" \
    --project=${PROJECT}
  echo "  created"
fi

# 4. Mirror to Secret Manager (so AI can pull it from anywhere)
echo "→ Mirroring key to Secret Manager (OPERATOR_SA_KEY)…"
if gcloud secrets describe OPERATOR_SA_KEY --project=${PROJECT} >/dev/null 2>&1; then
  gcloud secrets versions add OPERATOR_SA_KEY \
    --data-file="${KEY_PATH}" \
    --project=${PROJECT} >/dev/null
  echo "  added new version"
else
  gcloud secrets create OPERATOR_SA_KEY \
    --data-file="${KEY_PATH}" \
    --project=${PROJECT} \
    --replication-policy=automatic >/dev/null
  echo "  created secret"
fi

echo ""
echo "✅ Setup complete."
echo ""
echo "Next steps:"
echo "  1. Add config/operator-sa.json to .gitignore (this script auto-checks)"
echo "  2. Activate the operator SA whenever needed:"
echo "       bash scripts/ops/auth.sh"
echo ""
echo "  Service account: ${SA_EMAIL}"
echo "  Local key: ${KEY_PATH}"
echo "  Secret Manager: OPERATOR_SA_KEY"
