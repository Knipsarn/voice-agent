# Onboarding and Operations

## Onboarding goal
Create a new tenant mostly through data and assets, not custom engineering.

## Inputs for onboarding
For each new customer, collect:
- company name
- phone number
- whether they want direct-to-GPT or PBX-first
- first message
- base prompt
- mode/workflow prompt blocks
- audio assets
- preferred voice
- language rules

## Target onboarding workflow
### Step 1
Prepare a tenant draft config file in the repo.

### Step 2
Upload audio assets to Cloud Storage under a tenant folder.

### Step 3
Validate tenant config.

### Step 4
Write tenant config to Firestore.

### Step 5
Write called-number route to `phone_number_routes`.

### Step 6
Run smoke test.

## Operational workflow
### Small change
Example: update first message.
- update Firestore document
- no code deploy required

### Asset change
Example: new intro audio.
- upload new file to Storage
- update Firestore asset path

### Platform logic change
Example: new runtime mode-switch logic.
- create Git branch
- modify bridge code
- test
- deploy new Cloud Run revision

## Error workflow
Long-term goal:
- AI or operator should be able to inspect recent logs and tenant events without manually opening many dashboards

## Design principle
### Customer changes should be config changes
Most customer requests should not cause a code deploy.
