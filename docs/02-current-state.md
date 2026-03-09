# Current State

## What already works
A minimal bridge was built and deployed to Google Cloud Run. It successfully handled:
- incoming Telnyx media stream
- live WebSocket connection to OpenAI GPT-Realtime
- audio returned back into the PSTN call

## Current deployed runtime
- Google Cloud project: `ldk-clean`
- Region: `europe-west1`
- Cloud Run service: `voice-bridge-service`
- Current public HTTPS URL: `https://voice-bridge-service-360579353014.europe-west1.run.app`
- Current WebSocket URL used by Telnyx: `wss://voice-bridge-service-360579353014.europe-west1.run.app`

## Current tested audio path
- Telnyx bidirectional streaming
- codec path aligned to G.711 μ-law
- OpenAI realtime session configured with `g711_ulaw` input and output

## Current MVP behavior
- Telnyx connects to the Cloud Run bridge over WebSocket
- bridge opens an OpenAI Realtime WebSocket session
- bridge forwards inbound media payloads to OpenAI
- bridge forwards OpenAI audio deltas back to Telnyx
- current instructions are minimal and static
- current setup is single-tenant in practice, even though the same service could technically handle multiple tenants

## Known MVP limitations
- no tenant lookup yet
- no config database
- no per-customer voice or prompt loading
- no first-message orchestration yet
- no mode switching framework yet
- no admin API yet
- no formal onboarding script yet
- no structured logging per tenant yet

## Current bridge code
The current MVP bridge code is included in `apps/voice-bridge/index.js`.
