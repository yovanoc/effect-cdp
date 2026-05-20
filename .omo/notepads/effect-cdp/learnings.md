# Learnings

## [2026-05-20T08:34] Initial project state

- `package.json`: type:module, has effect/platform-bun/platform-node/devtools-protocol. MISSING: @effect/platform base, scripts codegen/check-codegen/smoke/test:unit, engines field
- `tsconfig.json`: strict, nodenext, good. MISSING scripts/**/\* and tests/**/\* in include
- `src/index.ts`: hello-world stub only
- `scripts/`: only prepare-effect.sh, NO codegen.ts or smoke.ts stubs
- `tests/`: has example.test.ts, no codegen/ subdir
- devtools-protocol installed: json/browser_protocol.json + json/js_protocol.json both present
- bun.lock present (bun install already ran)
- uses tsgo (effect-tsgo) + @effect/language-service plugin
- tscheck command is: `tsgo --noEmit`
- NOTE: test dir is `tests/` (plural) not `test/`

## Effect v4 Conventions

- Effectful wrappers: use `Effect.fnUntraced` (NOT arrow + Effect.gen) unless spans needed
- An `Effect.fnUntraced` that only yields and returns is disallowed - write the direct expression
- Outside generators, yieldables need `.asEffect()` before piping
- Streaming: use Effect `Stream`. SSE: `effect/unstable/encoding/Sse`. WS: first-party socket abstractions
- Final live layers typed as `Layer.Layer<ProvidedServices>` (no error channel)
- Never `Effect.orDie` - use `Effect.catchTag`/`catchTags` then `Effect.die` only for unrecoverable
- No global `Error` class - use `Schema.TaggedError` with `_tag`
- No `if ("_tag" in error)` probes - errors are already TaggedError with typed \_tag
- Yield services from context inside bodies - DO NOT pass as fn args
- No generic errors like XFailed/InternalError/UnknownError
- No `Schema.Unknown` in app code
- `CdpRequestId = number & Brand` (NOT bigint)
- Use `Schema.brand(...)` on primitive schemas, then expose `makeUnsafe` as a thin wrapper around `.make(...)` on the branded schema when a local constructor helper is needed

## 2026-05-20

- Shared schema seed file lives at `src/generated/Shared.ts` with the `// AUTO-GENERATED ANCHOR` marker.
- `Schema.optional(...)` in Effect v4 pairs cleanly with optional properties when the property type includes `| undefined`.
- Recursive seed types should use `Schema.suspend(() => ...)` plus an explicit `Schema.Schema<...>` annotation.

## [2026-05-20] HttpDiscovery (Task 4)

- HTTP client in Effect v4 lives at `effect/unstable/http` (NOT `@effect/platform`). Import `HttpClient`, `HttpClientResponse`, `FetchHttpClient` from there.
- `FetchHttpClient.layer: Layer.Layer<HttpClient.HttpClient>` replaces v3's `HttpClient.Default`.
- `HttpClientResponse.schemaJson(schema)` expects the schema's ENCODED form to match `{status?, headers?, body?}` shape (it wraps with `Schema.toCodecJson`). For decoding only the JSON body, use `HttpClientResponse.schemaBodyJson(schema)` instead - it returns `Effect<S["Type"], E | SchemaError, S["DecodingServices"]>`.
- v4 HTTP client errors are unified under a single `HttpClientError` tag (no separate `RequestError`/`ResponseError`). Use `Effect.catchTag("HttpClientError", ...)`.
- `Effect.catchAll` renamed to `Effect.catch` in v4.
- `Schema.SchemaError` has `_tag: "SchemaError"`. Stringify with `Cause.pretty(Cause.fail(error))` since `Cause.pretty` takes a `Cause`, not an error directly.
- v4 uses `Context.Service` (NOT `Effect.Service` - that doesn't exist). Class syntax: `class Foo extends Context.Service<Foo, {...}>()("id") {}`.
- `CdpConfig` is a `Schema.Struct`, not a service. Services that depend on config accept `typeof CdpConfig.Type` as a constructor parameter and expose `static layer(config)`.

## [2026-05-20] Socket bridge (Task 12)

- `effect/unstable/socket` exports the `Socket` namespace from `unstable/socket/index.ts`; `Socket.Socket.run` receives `Uint8Array` chunks, while `runRaw` preserves `string | Uint8Array`.
- `Queue.offerUnsafe(queue, chunk)` is the v4 synchronous queue API; callbacks passed to `socket.run` must not return its boolean, so wrap it in a block.
- `Stream.fromQueue(queue)` consumes until `Queue.shutdown(queue)` or consumer interruption; scoped bridge consumers forked with `Effect.forkScoped` interrupt when the surrounding scope closes.

## [2026-05-20] Recursive codegen helpers (Task 10)

- Recursive type detection now lives in `scripts/codegen/detectRecursive.ts`; it is pure and marks only `$ref` cycles inside the provided domain type list.
- `Schema.suspend` signature in vendored Effect is `suspend<S extends Top>(f: () => S): suspend<S>`; emitted recursive schemas need an explicit `Schema.Schema<ForwardType>` annotation before `Schema.suspend(() => ...)`.
- The requested `.repos/effect/LLMS.md` file is absent in this checkout; `.repos/effect/AGENTS.md` is present and tool-injected when reading vendored Effect files.

## [2026-05-20] Codegen schema emitter (Task 8)

- `scripts/codegen/emit/schema.ts` emits pure Effect Schema source strings from CDP `TypeDef` / `TypeRef` nodes; it does not import runtime `Schema` because generated domain modules own surrounding imports.
- Effect v4 `Schema.Literals` signature is `Schema.Literals([...values])`; use array form for CDP enums.
- Use `Schema.Json` for CDP `any`, untyped objects, object refs without properties, and array items missing a concrete type; never emit `Schema.Unknown`.

## [2026-05-20] PendingMap (Task 14)

- `PendingMap` lives at `src/internal/pending.ts` as a `Context.Service` with per-connection `Ref<HashMap>` state and a `closedRef`.
- Outstanding CDP deferreds must include `CdpDisconnected` in their error channel because `drainAll` / `drainSession` complete existing waits with disconnect reasons.
- Atomic remove-then-complete uses `Ref.modify(pendingRef, map => [HashMap.get(map, id), HashMap.remove(map, id)])`; session drain partitions inside one `Ref.modify` then fails captured entries outside the ref update.

## T30 — runDisconnect (smoke.ts)

- Effect v4: `Effect.fork` → `Effect.forkChild`; `Effect.catchAll` → `Effect.catch`.
- Spawn chromium via node `child_process.spawn` wrapped in `Effect.acquireRelease` for SIGKILL on scope close. `--headless=new --user-data-dir=<tmp>` + dedicated port (9333) to avoid colliding with 9222.
- Poll `/json/version` via `Effect.tryPromise` + catch to bool; loop with `Effect.sleep` + `Date.now()` budget.
- Assert disconnect via `Cause.findErrorOption` + `instanceof CdpDisconnected` + `reason === "SocketClosed"`. Measure elapsed from SIGKILL ts (returned by killer fiber via `Fiber.join`) to send-failure ts.
- Pre-existing bug: `src/generated/Emulation.ts:270` throws `ReferenceError: Cannot access 'RGBA' before initialization` — affects ALL smoke sub-tests, not just disconnect. Out of scope for T30 but blocks runtime verification of AC4 logs.

## T?? — runBackpressure (AC8, smoke.ts)

- `Metric.counter(name)` is keyed by name in a global registry. Calling `Metric.counter("cdp_events_dropped_total")` in `smoke.ts` returns the SAME counter the EventBus increments — no service exposure needed.
- `Metric.value(counter)` yields `CounterState<number>` with `{ count, incremental }`. Read before + after, assert `after.count - before.count > 0`.
- Backpressure repro: subscribe to `cdp.session(sid).events` via `Stream.runForEach` with `Effect.sleep("50 millis")` per event, then flood ~500 `console.log` calls in one `Runtime.evaluate` loop. PubSub buffer is `eventBufferSize=64` (dropping), so 500 events with a 50ms-per-event consumer overflows reliably.
- `Runtime.enable` must be sent before flood — otherwise `Runtime.consoleAPICalled` events are not emitted.
- Fork consumer with `Effect.forkChild`, interrupt via `Fiber.interrupt` after measurement (otherwise scope close hangs on the slow consumer).

## T37 — Documentation (README.md, AGENTS.md, ADR-001)

- **README.md structure**: 1-page format with install, quickstart (real API usage), feature matrix, v1 scope OUT, backpressure note, errors table
- **AGENTS.md additions**: Analysis methodology (explore first, check vendored source), never-invent rule, debundle/latest rule, codegen architecture (input → scripts/codegen.ts → 58 domains), circular import fix (SCC + Schema.suspend), smoke test structure
- **ADR-001 rationale**: Custom dispatcher chosen over @effect/rpc due to (1) session multiplexing mismatch, (2) event model mismatch (server-initiated vs RPC subscriptions), (3) protocol simplicity makes @effect/rpc overhead unnecessary, (4) full type safety achievable without it
- **Trade-offs documented**: Custom = ~200 LOC, minimal overhead, full control; @effect/rpc = less maintenance burden but constrained API and unnecessary complexity for raw JSON-RPC
- **File paths**:
  - `README.md` — Public-facing quickstart and API overview
  - `AGENTS.md` — Development methodology and architecture rules
  - `docs/adr/ADR-001-custom-dispatcher.md` — Architecture decision record

## T?? — runMultiSession (AC9, smoke.ts)

- Cross-session isolation: `cdp.session(sid).events` is just `allEvents.pipe(Stream.filter(e => e.sessionId === sid))` — the filter is the entire isolation mechanism. Test attaches sessionA on the discovered page target, creates a 2nd page via `Target.createTarget`, attaches sessionB on it, fires `console.log(marker)` on sessionA only, asserts sessionB's filtered stream receives 0 marker events (and sessionA receives ≥1).
- Both sessions need `Runtime.enable` sent before the fire, otherwise `Runtime.consoleAPICalled` won't be emitted.
- Subscriber fibers (`Effect.forkChild`) need `Effect.sleep("100 millis")` before firing so they attach to the PubSub first — same pattern as runBackpressure.
- Marker detection: inspect `params.args[].value` (Runtime.RemoteObject) for the string match. Use a typed predicate over `event.params` (which is `Schema.Json`) — narrow with `typeof === "object"` + `Array.isArray` checks, no casts.
- Interrupt both consumer fibers (`Fiber.interrupt`) before reading Ref counts so the scope closes cleanly.
