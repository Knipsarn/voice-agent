#!/usr/bin/env bash
# scripts/setup/error-agent-pipeline.sh
#
# Wires the AI error agent pipeline:
#   1. Pub/Sub topic           voice-platform-errors
#   2. Cloud Logging sink      error-sink → publishes errors to that topic
#   3. Pub/Sub push subscription that delivers to error-agent-service /
#   4. Grants the sink writer + Pub/Sub invoker SAs the right permissions
#
# Run once after the error-agent service has been deployed.
#
# Usage:
#   bash scripts/setup/error-agent-pipeline.sh

set -euo pipefail

PROJECT="ldk-clean"
REGION="europe-west1"
TOPIC="voice-platform-errors"
SINK_NAME="error-sink"
SUB_NAME="voice-platform-errors-to-agent"
SERVICE="error-agent-service"
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT} --format="value(projectNumber)")

# Logs filter — services we care about, severity ERROR+
LOG_FILTER='resource.type="cloud_run_revision"
AND (resource.labels.service_name="voice-bridge-service"
     OR resource.labels.service_name="control-plane-service"
     OR resource.labels.service_name="telephony-service"
     OR resource.labels.service_name="post-processor-service")
AND severity>=ERROR'

echo "→ 1. Pub/Sub topic ${TOPIC}…"
if gcloud pubsub topics describe ${TOPIC} --project=${PROJECT} >/dev/null 2>&1; then
  echo "  exists"
else
  gcloud pubsub topics create ${TOPIC} --project=${PROJECT}
fi

echo "→ 2. Cloud Logging sink ${SINK_NAME}…"
if gcloud logging sinks describe ${SINK_NAME} --project=${PROJECT} >/dev/null 2>&1; then
  echo "  exists, updating filter"
  gcloud logging sinks update ${SINK_NAME} \
    "pubsub.googleapis.com/projects/${PROJECT}/topics/${TOPIC}" \
    --log-filter="${LOG_FILTER}" \
    --project=${PROJECT}
else
  gcloud logging sinks create ${SINK_NAME} \
    "pubsub.googleapis.com/projects/${PROJECT}/topics/${TOPIC}" \
    --log-filter="${LOG_FILTER}" \
    --project=${PROJECT}
fi

# 3. Grant the sink's writer SA permission to publish to the topic
SINK_WRITER=$(gcloud logging sinks describe ${SINK_NAME} --project=${PROJECT} --format="value(writerIdentity)")
echo "→ 3. Granting ${SINK_WRITER} → roles/pubsub.publisher on ${TOPIC}…"
gcloud pubsub topics add-iam-policy-binding ${TOPIC} \
  --member="${SINK_WRITER}" \
  --role="roles/pubsub.publisher" \
  --project=${PROJECT} >/dev/null

# 4. Get error-agent service URL
echo "→ 4. Looking up ${SERVICE} URL…"
SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.url)" 2>/dev/null || true)

if [ -z "$SERVICE_URL" ]; then
  echo "❌ Service ${SERVICE} not deployed yet. Push to main to trigger CI/CD, then re-run this script."
  exit 1
fi
echo "  ${SERVICE_URL}"

# 5. Pub/Sub push subscription needs an invoker SA
PUSH_SA="error-agent-invoker@${PROJECT}.iam.gserviceaccount.com"
echo "→ 5. Push invoker SA ${PUSH_SA}…"
if gcloud iam service-accounts describe ${PUSH_SA} --project=${PROJECT} >/dev/null 2>&1; then
  echo "  exists"
else
  gcloud iam service-accounts create error-agent-invoker \
    --project=${PROJECT} \
    --display-name="Error Agent Pub/Sub Invoker"
fi

# Allow it to invoke the Cloud Run service
gcloud run services add-iam-policy-binding ${SERVICE} \
  --member="serviceAccount:${PUSH_SA}" \
  --role="roles/run.invoker" \
  --region=${REGION} \
  --project=${PROJECT} >/dev/null

# Allow Pub/Sub service agent to mint OIDC tokens for this SA
gcloud iam service-accounts add-iam-policy-binding ${PUSH_SA} \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=${PROJECT} >/dev/null

# 6. Pub/Sub push subscription
echo "→ 6. Push subscription ${SUB_NAME}…"
if gcloud pubsub subscriptions describe ${SUB_NAME} --project=${PROJECT} >/dev/null 2>&1; then
  echo "  exists, updating push endpoint"
  gcloud pubsub subscriptions update ${SUB_NAME} \
    --push-endpoint="${SERVICE_URL}/" \
    --push-auth-service-account="${PUSH_SA}" \
    --project=${PROJECT} >/dev/null
else
  gcloud pubsub subscriptions create ${SUB_NAME} \
    --topic=${TOPIC} \
    --push-endpoint="${SERVICE_URL}/" \
    --push-auth-service-account="${PUSH_SA}" \
    --ack-deadline=60 \
    --message-retention-duration=7d \
    --project=${PROJECT}
fi

echo ""
echo "✅ Error agent pipeline live."
echo ""
echo "  Topic:        ${TOPIC}"
echo "  Sink filter:  Cloud Run errors from voice-bridge / control-plane / telephony / post-processor"
echo "  Subscription: ${SUB_NAME} → ${SERVICE_URL}/"
echo ""
echo "Verify by triggering a deliberate error or checking Firestore incidents/ in a few minutes."
