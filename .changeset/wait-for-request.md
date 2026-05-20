---
"effect-cdp": patch
---

Add `waitForRequest` helper to `effect-cdp/helpers/Network` — mirrors the existing `waitForResponse` pattern for observing outbound network requests via `Network.requestWillBeSent` events.
