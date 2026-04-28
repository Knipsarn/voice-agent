#!/usr/bin/env bash
# scripts/ops/auth.sh
#
# Activate the operator service account so gcloud + ADC work without
# interactive login. Run this when the AI / ops scripts hit
# "invalid_grant" or "Reauthentication failed".
#
# Looks for the SA key in this order:
#   1. config/operator-sa.json (local)
#   2. Pulls from Secret Manager (OPERATOR_SA_KEY) using current gcloud auth
#
# Usage:
#   bash scripts/ops/auth.sh

set -euo pipefail

PROJECT="ldk-clean"
SA_EMAIL="voice-platform-operator@${PROJECT}.iam.gserviceaccount.com"
KEY_PATH="config/operator-sa.json"

# 1. If local key missing, try to pull from Secret Manager (needs valid user auth first)
if [ ! -f "${KEY_PATH}" ]; then
  echo "→ Local key not found, pulling from Secret Manager…"
  mkdir -p "$(dirname "${KEY_PATH}")"
  if ! gcloud secrets versions access latest --secret=OPERATOR_SA_KEY \
       --project=${PROJECT} > "${KEY_PATH}" 2>/dev/null; then
    echo "❌ Could not pull OPERATOR_SA_KEY from Secret Manager."
    echo "   Run scripts/setup/operator-sa.sh first (with personal gcloud auth)."
    rm -f "${KEY_PATH}"
    exit 1
  fi
  chmod 600 "${KEY_PATH}"
  echo "  pulled to ${KEY_PATH}"
fi

# 2. Activate the SA in gcloud
echo "→ Activating ${SA_EMAIL} in gcloud…"
gcloud auth activate-service-account "${SA_EMAIL}" \
  --key-file="${KEY_PATH}" \
  --project="${PROJECT}"

# 3. Set as default + ADC
gcloud config set account "${SA_EMAIL}" --quiet
gcloud config set project "${PROJECT}" --quiet

# 4. Set Application Default Credentials so Node/Firestore/etc work
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/${KEY_PATH}"

# Persist for shell sessions:
ENV_LINE="export GOOGLE_APPLICATION_CREDENTIALS=\"$(pwd)/${KEY_PATH}\""
if [ -f config/.env ] && ! grep -q "GOOGLE_APPLICATION_CREDENTIALS" config/.env 2>/dev/null; then
  echo "${ENV_LINE/export /}" >> config/.env
fi

echo ""
echo "✅ Operator service account active."
echo "   Account:  ${SA_EMAIL}"
echo "   ADC key:  ${GOOGLE_APPLICATION_CREDENTIALS}"
echo ""
echo "Test: gcloud auth list"
