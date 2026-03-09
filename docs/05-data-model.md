# Data Model

## Recommended top-level Firestore collections
- `tenants`
- `phone_number_routes`
- `call_sessions`
- `operations_events`

## tenants document shape
Recommended structure per tenant:

```json
{
  "tenant_id": "vastinstallation",
  "status": "active",
  "company_name": "Västinstallation AB",
  "default_language": "sv-SE",
  "voice": "alloy",
  "realtime_model": "gpt-realtime-1.5",
  "entry_mode": "pbx_first",
  "first_message_enabled": true,
  "first_message": "Hej och välkommen till Västinstallation. Hur kan jag hjälpa dig idag?",
  "instructions": {
    "base": "Base system instructions...",
    "default_mode": "GENERAL"
  },
  "modes": {
    "GENERAL": {
      "label": "General support",
      "instructions": "General mode instructions...",
      "unlock_blocks": ["company_intro", "contact_rules"]
    },
    "BILLING": {
      "label": "Billing",
      "instructions": "Billing mode instructions...",
      "unlock_blocks": ["billing_rules"]
    }
  },
  "knowledge_blocks": {
    "company_intro": "Company info block...",
    "contact_rules": "Contact and collection rules...",
    "billing_rules": "Billing instructions..."
  },
  "audio_assets": {
    "intro": "gs://voice-assets/vastinstallation/intro.mp3",
    "voicemail": "gs://voice-assets/vastinstallation/voicemail.mp3"
  },
  "phone_numbers": {
    "primary_e164": "+46700000000"
  },
  "pbx": {
    "enabled": true,
    "ai_option_digit": "1",
    "voicemail_option_digit": "2"
  },
  "features": {
    "direct_to_gpt": false,
    "barge_in": true,
    "mode_switching": true
  },
  "updated_at": "server_timestamp"
}
```

## phone_number_routes
Use this collection to resolve the called number into a tenant.

```json
{
  "phone_e164": "+46700000000",
  "tenant_id": "vastinstallation",
  "entry_mode": "pbx_first",
  "active": true
}
```

## call_sessions
Optional runtime session metadata for support/debugging.

```json
{
  "session_id": "...",
  "tenant_id": "vastinstallation",
  "call_control_id": "...",
  "called_number": "+46700000000",
  "from_number": "+46711111111",
  "active_mode": "GENERAL",
  "cloud_run_revision": "voice-bridge-service-00001-rqz",
  "started_at": "server_timestamp",
  "status": "active"
}
```

## operations_events
For onboarding, failures, warnings, and AI-ops later.

```json
{
  "type": "bridge_error",
  "tenant_id": "vastinstallation",
  "severity": "error",
  "message": "OpenAI websocket closed unexpectedly",
  "metadata": {},
  "created_at": "server_timestamp"
}
```
