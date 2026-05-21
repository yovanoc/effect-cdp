---
"effect-cdp": patch
---

Prevent bundler from code-splitting `@effect/platform-node` and `@effect/platform-bun` dynamic imports by adding `@rolldown-ignore` comments. Without this, the bundler creates chunks that reference `ioredis` which is unavailable in Cloudflare Workers.
