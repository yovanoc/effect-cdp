# effect-cdp

## Vendored Repositories

This project vendors external repositories under @repos/

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under @repos/ unless explicitly asked
- Do not import from @repos/ - application code should continue importing from normal package dependencies

When writing Effect code, inspect @.repos/effect/ for examples of idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns.

always read @.repos/effect/LLMS.md before writing any Effect code.

## Effect

- Effectful wrappers must use `Effect.fnUntraced` unless spans are required. Use `Effect.fn` when spans are needed. Do not write `(...args) => Effect.gen(function* () { ... })`.
- An `Effect.fnUntraced` that only does `return yield* effect` is not allowed. Write the direct effect expression instead of wrapping it in a generator.
- Outside generators, yieldables must be converted with `.asEffect()` before piping.
- All streaming implementations, including SSE and WebSockets, must use Effect `Stream`. SSE must use `effect/unstable/encoding/Sse` for framing. WebSockets must use first party Effect socket abstractions.
- Final live layers (`Rpc.toLayer`, service layers, middleware layers) must be typed as `Layer.Layer<ProvidedServices>`. Intermediate and test-exported layers must infer naturally. Use `Layer.orDie` only on final live compositions whose remaining errors are truly unrecoverable.
- Never use `Effect.orDie`. Handle typed errors explicitly with `Effect.catchTag` or `Effect.catchTags`, then `Effect.die` only when the failure is genuinely unrecoverable.
- Do not use the global `Error` class in app code. Use `Schema.TaggedError` with a `_tag` discriminator. Reuse an existing tagged error when one already fits.
- Do not probe errors with checks like `if ("_tag" in error)`. That is an anti pattern. All app errors must already be `Schema.TaggedError` values with a typed `_tag`, so match on the typed error channel instead.
- Yield services from context inside effect bodies. Do not pass service instances as function arguments.
- Services must expose typed errors, not defects.
- Services must expose typed errors only for actionable failures that callers can handle. If a tagged error has a `reason` field, it must use `Schema.Literals(...)` with PascalCase values.
- Non actionable failures must not be exposed as typed errors. Catch them at the service definition with `Effect.catchTag` or `Effect.catchTags` and `Effect.die`, or let existing defects propagate naturally.
- Do not invent generic typed errors like `XFailed`, `InternalError`, or `UnknownError`. When a failure is actionable, define a specific `Schema.TaggedError` for it.
- Do not erase error channels with `unknown` in `Effect<A, unknown>`, `Cause<unknown>`, or `Exit<A, unknown>`. Keep expected errors precisely typed so callers can safely pattern match on `_tag`.
- When turning Effect causes into user visible or event payload text, use `Cause.pretty(...)`. Do not add bespoke `xFailureToMessage` style helpers. If an error needs a better message than its `_tag` or existing fields provide, define that message on the tagged error itself.
- Do not use `Schema.Unknown` in app code or AI output schemas. Use explicit `Schema.Struct` shapes or `Schema.Json`.

## Architecture

- Prefer referentially transparent and pure functions.
- Immutability is required unless code is truly performance critical, which is rare.
- Default props, params, and collections to readonly shapes such as `readonly` properties and `ReadonlyArray`.
- Prefer Effect collection modules such as `Array` for immutable collection transforms.
- For repeated or complex nested immutable updates, use Effect `Optic`.
- Prefer flat directory structures. Each module should have its own directory with its files directly inside it instead of extra nesting layers.
- Follow DDD style colocation. Define domain modules inside the directory for that domain, export them there, and import them from that domain location instead of creating global shared domain modules.
- Entity IDs are branded with `Schema.brand` in the owning RPC module. Construct branded IDs with `EntityId.makeUnsafe()`. Never cast with `as EntityId`.
- No barrel `index.ts` files. Import from the defining module.
- Do not use optional properties when every consumer passes the value. Reserve them for generic primitive level modules.
- Pipeable values must use `.pipe(...)`. Non pipeable values must use Effect `pipe()` and `flow()`. Do not write nested application like `f(g(x))`.
- Named schemas must add `.annotate({ identifier: "MySchemaName" })`.

## Observability

- Do not add manual logging or log annotations for error paths. OTEL spans already capture failures and context.
- Tracing must use `Effect.withSpan` or `Effect.fn`.
- Logging is only for domain level informational events like startup or sync progress.

## Testing

- Non autogenerated code must maintain at least 80 percent test coverage.
- Coverage is a floor, not a goal. Write high value tests only, and do not add low value, redundant, or superfluous tests just to increase coverage.
- Tests use production composition. Mock only true external boundaries by swapping the boundary layer.
- Prefer regression tests, user path tests, and business logic tests that prevent future breakage.
- For bug fixes, add a regression test when practical.
- Prefer behavior and contract tests over implementation detail tests.
- Tests must be deterministic. Do not rely on arbitrary sleeps, timing races, or uncontrolled external state.
- For time dependent Effect tests, use `TestClock` and advance logical time with `TestClock.adjust(...)` or `TestClock.setTime(...)` instead of waiting on wall clock time.
- Use live time only for true external timing boundaries that `TestClock` cannot control.
- Do not test what TypeScript already proves, such as simple invalid argument types, unless the code relies on complex type level behavior in reusable library style code.
- Do not test behavior that third party libraries already guarantee unless the repo adds meaningful integration logic on top.

## Analysis Methodology

When working in this codebase:

1. **Explore first** — Before implementing, search existing patterns with grep/ast-grep
2. **Check vendored source** — Always inspect `.repos/effect/` for idiomatic Effect patterns; never invent APIs
3. **Read actual source** — Never guess API names; read the real exports from `src/index.ts`
4. **Verify with types** — Run `bun run ts:check` after any change

## Codegen Architecture

The project uses a custom code generation pipeline:

- **Input**: `devtools-protocol` JSON schema (`json/browser_protocol.json`, `json/js_protocol.json`)
- **Script**: `scripts/codegen.ts` orchestrates generation
- **Output**: `src/generated/*.ts` — one module per CDP domain (58 total)
- **Key outputs**:
  - `src/generated/CdpSchema.ts` — Domain-level schemas
  - `src/generated/Shared.ts` — Cross-domain types (with `// AUTO-GENERATED ANCHOR` marker)
  - `src/generated/<Domain>.ts` — Per-domain commands, events, and types

Each generated domain exports:

- Command schemas as `CdpCommand<Params, Result>` bundles
- Event types for streaming
- Type-safe Schema definitions

## Circular Import Fix

Circular dependencies between domains are resolved via:

1. **SCC detection**: `scripts/codegen/detectRecursive.ts` identifies `$ref` cycles
2. **Schema.suspend**: Recursive types wrap with `Schema.suspend(() => X)` plus explicit `Schema.Schema<Type>` annotation
3. **Domain-level**: Cycles resolved at domain boundaries, not individual types

Example:

```typescript
// Instead of direct reference causing TDZ error:
const Node: Schema.Schema<Node> = Schema.Struct({ ... }) // ❌ Circular

// Use suspend with annotation:
const Node: Schema.Schema<Node> = Schema.suspend(() =>
  Schema.Struct({ ... })
) // ✅ Lazy, resolves cycle
```

## Smoke Test Structure

Smoke tests in `scripts/smoke.ts` verify runtime behavior against live Chromium:

- **Requirement**: Chromium running with `--remote-debugging-port=9222`
- **Tests**:
  - Basic command/response round-trip
  - Session creation and event streaming
  - Page navigation with load event waiting
  - Runtime script evaluation
  - Connection teardown and disconnect detection
  - Backpressure (dropping queue) verification

Run: `bun run smoke`

## Development Rules

- **Never-invent rule**: Always check `.repos/effect/` for idiomatic patterns first
- **Debundle/latest rule**: Use `debundle/latest` output as source of truth for API behavior
- **Generated code**: Never manually edit `src/generated/*.ts` — modify `scripts/codegen/` instead
- **Error handling**: All app errors must be `Schema.TaggedError` — no generic errors
- **No barrel files**: Import from defining modules, not `index.ts`
