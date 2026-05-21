---
"effect-cdp": patch
---

Fix worker startup crash by lazy-loading `@effect/platform-node` and `@effect/platform-bun` in `layerNode`/`layerBun` methods. Module-level imports caused `node:net` errors in Cloudflare Workers. Use `Effect.promise(() => import(...))` to defer loading until the layer is actually built.
