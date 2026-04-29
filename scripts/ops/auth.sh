#!/usr/bin/env bash
# scripts/ops/auth.sh
#
# Re-authenticate gcloud when your session expires.
# SA key creation is blocked by org policy, so we use personal OAuth +
# SA impersonation — refresh token lasts ~6 months.
#
# Usage:
#   bash scripts/ops/auth.sh

set -euo pipefail

PROJECT="ldk-clean"
SA_EMAIL="voice-platform-operator@${PROJECT}.iam.gserviceaccount.com"

echo "→ Logging in + setting application-default credentials (impersonating ${SA_EMAIL})…"
echo "  Your browser will open — sign in with nils.wahlin@snmintegrations.se"
gcloud auth login --project="${PROJECT}"
gcloud auth application-default login \
  --impersonate-service-account="${SA_EMAIL}"

echo ""
echo "✅ Auth complete. gcloud and ADC now impersonate ${SA_EMAIL}."
echo "   Refresh token lasts ~6 months before you need to run this again."
echo ""
echo "Test: gcloud auth list"
