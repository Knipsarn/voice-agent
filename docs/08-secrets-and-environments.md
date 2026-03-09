# Secrets and Environments

## Rule
Never store raw secrets in repo handoff files.
Only store:
- secret names
- where they live
- what service uses them

## Current known secrets / config locations
### OpenAI API key
- secret name: `openAI`
- current runtime use: Cloud Run secret injection into `OPENAI_API_KEY`

### Telnyx API key
- should live in Secret Manager or the PBX platform secret store
- should not be hardcoded in docs or source files

### Firestore / Firebase admin credentials
- preferred path: use service account permissions from Cloud Run or trusted server environment
- avoid raw JSON keys when possible

## Recommended environment variables for the bridge
- `OPENAI_API_KEY`
- `GOOGLE_CLOUD_PROJECT`
- `FIRESTORE_COLLECTION_TENANTS`
- `FIRESTORE_COLLECTION_PHONE_ROUTES`
- `GCS_AUDIO_BUCKET`
- `DEFAULT_REALTIME_MODEL`

## Environments
Recommended environments:
- local-dev
- staging
- production

## Secrets strategy
### Production
Use Google Secret Manager.

### Local development
Use a local `.env` file that is gitignored.

## Security principle
The AI assistant that edits code should never write real secret values into the repository.
