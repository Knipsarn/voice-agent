// Moved to apps/control-plane/lib/pipefy-sync.js so both the post-call
// integration AND the inbound-SMS handler can trigger it via /pipefy/sync.
// Keeping this file as a stub so any leftover require() throws clearly
// instead of silently using stale code.
throw new Error("pipefy.js was moved to apps/control-plane/lib/pipefy-sync.js — call POST /pipefy/sync instead");
