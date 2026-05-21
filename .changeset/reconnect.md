---
"effect-cdp": patch
---

Add `reconnect` option to `CdpConfig` for automatic connection retry with exponential backoff. When set, the initial WebSocket connection retries with `maxRetries` and `baseDelay` before failing.
