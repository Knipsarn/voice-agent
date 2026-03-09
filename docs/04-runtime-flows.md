# Runtime Flows

## Flow 1 — Direct-to-GPT tenant
Used when a business wants no PBX logic before the AI.

1. Customer calls business phone number
2. Telnyx sends call webhook to shared PBX endpoint or shared event endpoint
3. Platform identifies tenant by called number
4. Platform answers the call
5. Platform starts Telnyx streaming to the bridge
6. Bridge loads tenant config
7. Bridge creates GPT-Realtime session
8. Bridge applies base instructions + mode + voice + first message
9. Live call continues through the bridge

## Flow 2 — PBX-first tenant
Used when a business wants pre-AI logic.

1. Customer calls business phone number
2. Telnyx sends webhook to shared PBX router
3. PBX router identifies tenant by called number
4. PBX plays customer-specific audio or gather logic
5. PBX decides whether to:
   - go to AI
   - go to voicemail
   - go to human path
   - go to other path
6. If AI path is chosen, PBX starts streaming to the bridge
7. Bridge loads tenant config and continues

## Flow 3 — Mode switch during a live call
Example: user starts in general support, then needs billing.

1. Session begins in default mode
2. Bridge or agent logic identifies mode change condition
3. Bridge updates session instructions using config blocks
4. New mode-specific information becomes available
5. Conversation continues without changing services

## Flow 4 — First message
The platform should support a tenant-defined first message.

Recommended approach:
- after session creation and tenant config load, immediately trigger a response so GPT speaks first
- first message should come from tenant config

## Flow 5 — Error handling
When a runtime issue happens:
1. log tenant ID
2. log phone number
3. log Cloud Run revision
4. log mode and session metadata
5. optionally raise an operations event for later AI-assisted analysis
