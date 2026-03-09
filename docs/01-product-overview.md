# Product Overview

## Product vision
Build a voice AI platform for service businesses where a customer can call a company phone number and interact with an AI agent over a normal phone call.

The platform must support:
- many customers on one shared product runtime
- customer-specific behavior, prompts, audio files, and phone numbers
- customer onboarding with minimal manual engineering
- future agentic workflows where AI can help onboard new customers, change configuration, inspect failures, and propose code fixes

## Non-goals
- do not create one Cloud Run service per customer
- do not hardcode each customer directly into bridge code
- do not require manual Google Cloud Console work for each new tenant after the platform base is set up

## Strategic direction
### One shared platform
Use one shared runtime and identify the tenant by the called phone number, client state, or route metadata.

### Data over code
Customer differences should mostly be stored as data:
- prompts
- first message
- voice
- language
- audio asset URLs
- workflow modes
- routing policies

### Code only for platform behavior
Code should contain only shared platform logic:
- bridge logic
- session updates
- mode switching framework
- logging
- validation
- onboarding scripts
- admin APIs

## Supported entry patterns
The platform should support both of these customer types:

### Pattern A — Direct-to-GPT
The business wants incoming calls to go directly into the GPT agent with no PBX pre-flow.

### Pattern B — PBX-first
The business wants PBX logic first, such as:
- play intro audio
- press-a-key gather
- choose AI vs voicemail or other path
- then route to GPT

The same platform should support both patterns by using tenant configuration.
