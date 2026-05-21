---
"effect-cdp": patch
---

Prevent bundler from code-splitting platform imports (`@effect/platform-node`, `@effect/platform-bun`) by using variable-based `import()` that rolldown cannot statically analyse. Type aliases preserve full autocomplete without `as` casts.
