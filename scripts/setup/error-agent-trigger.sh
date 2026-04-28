#!/usr/bin/env bash
# scripts/setup/error-agent-trigger.sh
#
# One-time: register a Cloud Build trigger so pushing to main rebuilds and
# redeploys error-agent-service.
#
# Usage:
#   bash scripts/setup/error-agent-trigger.sh

set -euo pipefail

PROJECT="ldk-clean"
TRIGGER_NAME="deploy-error-agent"
REPO_OWNER="Knipsarn"
REPO_NAME="voice-agent"
BRANCH="main"

if gcloud beta builds triggers describe ${TRIGGER_NAME} --project=${PROJECT} >/dev/null 2>&1; then
  echo "→ Trigger ${TRIGGER_NAME} already exists, skipping"
  exit 0
fi

echo "→ Creating Cloud Build trigger ${TRIGGER_NAME}…"
gcloud beta builds triggers create github \
  --name=${TRIGGER_NAME} \
  --repo-owner=${REPO_OWNER} \
  --repo-name=${REPO_NAME} \
  --branch-pattern="^${BRANCH}\$" \
  --build-config=cloudbuild.error-agent.yaml \
  --project=${PROJECT}

echo "✅ Trigger created. Push to main to deploy error-agent."
