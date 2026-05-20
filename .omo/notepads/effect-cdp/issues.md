# Issues & Gotchas

## [2026-05-20T08:34] Known issues to watch

- tsconfig include only covers src/**/\* and test/**/_ — scripts/\*\*/_ and tests/\*_/_ need to be added (T1)
- @effect/platform base package not in package.json — needed for HttpClient (T4)
- src/index.ts is currently a hello-world stub — needs to become a re-exports skeleton
- No bunfig.toml yet (T1)
- scripts/codegen.ts and scripts/smoke.ts stubs missing (T1)

## [2026-05-20T16:10] Cross-domain circular import in generated CDP schemas — FIXED

**Symptom:** `ReferenceError: Cannot access 'RGBA' before initialization` at runtime when importing `src/generated/Emulation.ts:270` (`Schema.optional(DOM.RGBA)`). Blocked all smoke tests.

**Root cause:** `scripts/codegen/emit/schema.ts` `emitRef` emitted bare `Other.X` references for cross-domain `$ref`s. The CDP protocol has true SCCs at the domain level — `{DOM, Emulation, Network, Page, Security}` and `{Browser, Target}` — so circular ES module imports trip TDZ for top-level const exports. `detectRecursive` only catches intra-domain self-recursion; `resolveRefs` only extracts cross-domain SCC types into `Shared.ts` when they are themselves part of a type-level SCC (single types like `DOM.RGBA` with no outgoing cross-domain refs do NOT get extracted, so they stayed in their owner file but were still referenced from cyclically-imported modules).

**Fix:** Compute a **domain-level** SCC in `resolveRefs.ts` and expose `domainsInCycle: ReadonlySet<string>`. Thread through `emitTypeRef` / `emitCommand` / `emitEvent` / `emitTypeDef`. In `emitRef`, when both source and target domains are in the cycle set, wrap the reference: `Schema.suspend(() => Other.X)`. Lazy resolution defers the lookup until both modules finish initializing.

**Files changed:**

- `scripts/codegen/resolveRefs.ts` — added domain-graph SCC via `tarjanSCC`, exposes `domainsInCycle`
- `scripts/codegen/emit/schema.ts` — `emitRef`, `emitTypeRef`, `emitTypeDef`, `emitObject`, `emitPropertySchema` accept `cyclicDomains` and wrap with `Schema.suspend`
- `scripts/codegen/emit/command.ts` — threads `cyclicDomains` through `emitCommand`/`emitStruct`/`emitResult`/`emitPropertySchema`
- `scripts/codegen/emit/event.ts` — threads `cyclicDomains` through `emitEvent`/`emitParams`/`emitPropertySchema`
- `scripts/codegen.ts` — passes `resolved.domainsInCycle` into `buildDomainFile`
- `src/generated/*.ts` — regenerated; cross-domain refs in cyclic SCCs now wrapped with `Schema.suspend`

**Verification:**

- `bun run ts:check` — zero errors (suggestions only)
- `bun scripts/smoke.ts --test-default` — no `ReferenceError`. Fails on "no Chromium at 9222" which is expected in this env.

**Key learning:** `Schema.suspend(() => X)` is the Effect Schema idiom for deferring schema references. Required whenever cross-module references can be hit before the target module's top-level evaluation completes (i.e., any time two modules are in an ES-module import cycle and one references the other's top-level const exports). Detect via **domain-level SCC**, not just type-level SCC — a non-recursive type in a cyclically-imported domain is still affected.
