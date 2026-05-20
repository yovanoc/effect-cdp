# effect-cdp v1: Typed Effect Wrapper for Chrome DevTools Protocol

## TL;DR

> **Quick Summary**: Greenfield Effect v4 library wrapping Chrome DevTools Protocol over a single WebSocket, with codegen from `devtools-protocol` JSON, request multiplexing, session routing via lens, auto-attach, and observable backpressure. No browser launching, no reconnection — v1 scope locked tight.
>
> **Deliverables**:
>
> - `src/Cdp.ts` service + `CdpConnection`, `SessionRegistry` layers
> - `src/generated/<Domain>.ts` (one file per CDP domain, committed)
> - `src/helpers/{Page,Network,Runtime,DOM,Target,Form}.ts` (v1 helpers only)
> - `scripts/codegen.ts` + `scripts/check-codegen.ts` + `scripts/smoke.ts` (7 sub-tests)
> - `tests/codegen/*.test.ts` (≥80% line coverage island)
> - `README.md` + `AGENTS.md` (how-to-analyze + never-invent rules)
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 6 implementation waves + 1 verification wave
> **Critical Path**: Wave1.T2 (types) → W2.T12-14 (socket/pubsub/pending) → W3.T17 (dispatcher) → W4.T21 (Cdp service) → W5.T29 (default smoke AC1) → Final Wave

---

## Context

### Original Request

Build a TypeScript + Effect v4 library wrapping Chrome DevTools Protocol. Modernize `chrome-remote-interface` using Effect's strengths: multiplexing, session routing, auto-attach, event streams, typed generation, cleanup, cancellation, backpressure.

### Interview Summary

**Key Discussions** (round 1+2):

- Runtime: Node + Bun via `@effect/platform-{node,bun}` (locked)
- Dispatcher: CUSTOM on `Socket + Queue + PubSub + Deferred + Scope` (RpcMessage costume rejected — CDP events have no requestId)
- Codegen: from `devtools-protocol/json/{browser,js}_protocol.json` (committed output); `ProtocolMapping.d.ts` only for compile-time `satisfies` assertions
- Session model: lens over single `Cdp` service (no per-session class)
- Wire id: `CdpRequestId = number & Brand` (NOT bigint — breaks JSON)
- Events: `PubSub.dropping(N)` (avoids deadlock) + `Metric.counter("cdp_events_dropped_total")` + rate-limited logWarning (drops observable, not silent)
- Domain `Schema` collision: rename to `CdpSchema.ts`
- Recursives (~15): `Schema.suspend(() => ...)` with explicit type
- Errors: 4 only — `CdpDisconnected`, `CdpTimeout`, `CdpDecodeError`, `CdpProtocolError`
- Disconnect: terminal — caller owns retry
- Test policy: real-Chromium smoke + codegen unit-test island

**Research Findings**:

- `Socket.run(handler)` is callback-based, not Stream-pull → bridge via `Queue.unbounded` + `Stream.fromQueue`
- Effect v4: no `Schema.TaggedRequest` (use `Schema.Struct` per command directly)
- `PubSub.publishUnsafe` returns `Effect<boolean>` — `false` on dropping-strategy drop
- `Scope` finalizers run LIFO → register socket-close BEFORE pending-drain so drain runs first

### Metis Review (incorporated)

**New guardrails**: G15-G20 (fnUntraced default, no Layer.orDie intermediate, codegen no Schema.Unknown, eventBufferSize ≥16, no `export default`, send-after-close fails fast)
**New ACs**: AC7-AC11 (codegen coverage, backpressure metric, multi-session routing, timeout cleanup, HTTP discovery)
**Scope traps locked**: codegen richness, helper proliferation, autoAttach filtering, HttpClient retry, error literal enums, metric cardinality
**Edge cases**: empty vs absent `params`, no-sessionId root, both-result-and-error responses (error wins), event with `id` field (route by `method` presence not `id`), detach-before-attach race, codegen sort determinism, TextDecoder streaming mode, fire-and-forget pending leak (documented)

---

## Work Objectives

### Core Objective

Ship a typed Effect v4 CDP client that connects to an existing Chromium WebSocket endpoint, multiplexes requests, routes session events, exposes 7 v1 helpers, and dies cleanly with typed errors — codegen-driven and committed.

### Concrete Deliverables

- `src/Cdp.ts` — root `Cdp` service + `Cdp.session(SessionId)` lens
- `src/CdpConnection.ts` — Socket layer + dispatcher loop
- `src/SessionRegistry.ts` — attach/detach session tracking
- `src/CdpConfig.ts` — branded validated config (eventBufferSize ≥16)
- `src/errors.ts` — 4 `Schema.TaggedErrorClass` definitions
- `src/discovery/HttpDiscovery.ts` — `/json/version|list|new|close`
- `src/generated/<Domain>.ts` × ~50 — codegen output
- `src/generated/Shared.ts` — manually + codegen-curated cross-domain shared types
- `src/generated/CdpSchema.ts` — renamed `Schema` domain
- `src/helpers/{Page,Network,Runtime,DOM,Target,Form}.ts`
- `scripts/codegen.ts`, `scripts/check-codegen.ts`, `scripts/smoke.ts`
- `tests/codegen/{emitter,refResolver,recursiveDetector,jsdocEmitter}.test.ts`
- `README.md`, `AGENTS.md`, `package.json`, `tsconfig.json`, `.gitignore`

### Definition of Done

- [ ] AC1: `bun scripts/smoke.ts` exits 0 against real chromium on ws://localhost:9222
- [ ] AC2: `bun run ts:check` zero errors, no `any` leaking through `Schema.suspend`
- [ ] AC3: `bun run codegen && git diff --exit-code src/generated/` idempotent
- [ ] AC4: `bun scripts/smoke.ts --test-disconnect` exits 0 within 2s after SIGKILL chrome
- [ ] AC5: `bun scripts/smoke.ts --test-detach` exits 0 within 500ms after target detach
- [ ] AC6: `bun scripts/check-codegen.ts` zero errors (`satisfies ProtocolMapping`)
- [ ] AC7: `bun run test:unit` exits 0, ≥80% line coverage on `scripts/codegen/**`
- [ ] AC8: `bun scripts/smoke.ts --test-backpressure` exits 0, `cdp_events_dropped_total > 0`, no deadlock
- [ ] AC9: `bun scripts/smoke.ts --test-multi-session` exits 0, zero cross-session event leak
- [ ] AC10: `bun scripts/smoke.ts --test-timeout` exits 0, pending map size returns to 0 after `CdpTimeout`
- [ ] AC11: `bun scripts/smoke.ts --test-discovery` exits 0, parses `/json/version` + `/json/list`

### Must Have

- 4 typed errors only (`CdpDisconnected`, `CdpTimeout`, `CdpDecodeError`, `CdpProtocolError`)
- Codegen output committed under `src/generated/`
- Custom dispatcher (NOT `@effect/rpc`)
- `Queue.unbounded` inbound bridge (NOT `Socket.toChannel`)
- `PubSub.dropping(eventBufferSize)` events + drop metric + rate-limited warn
- Scope finalizer drains pending atomically with `CdpDisconnected`
- `CdpRequestId` branded `number` (NOT bigint)
- `Schema.Json` for unstructured fields (NEVER `Schema.Unknown`)
- `Schema.suspend(() => ...)` with explicit type for ~15 recursive CDP types
- Domain `Schema` renamed to `CdpSchema.ts`
- Route inbound frames by **`method` presence** (NOT `id` presence) — events first
- Both-result-and-error response: error wins
- Empty `params`/`sessionId`: omit key from wire frame
- TextDecoder with `{ fatal: false, ignoreBOM: false }` and `stream: true` per chunk

### Must NOT Have (Guardrails)

- **G1**: No `Schema.Unknown` anywhere (runtime or codegen)
- **G2**: No `Effect.orDie` anywhere
- **G3**: No `as any`, no `as unknown as X`
- **G4**: No `Target.sendMessageToTarget` (use `sessionId` on root frame)
- **G5**: No new typed errors beyond the 4
- **G6**: No `console.*` on error paths
- **G7**: No barrel `index.ts` files EXCEPT exactly two: (a) `src/index.ts` — the package public entrypoint exporting Cdp, helpers, errors, types ONLY (no internal/\* leaks); (b) `src/generated/index.ts` — re-exports generated CDP domain namespaces. ALL OTHER directories (including `src/helpers/`, `src/internal/`, `src/discovery/`) MUST NOT have an `index.ts` barrel — consumers import from defining modules directly.
- **G8**: No `PubSub.bounded` for events
- **G9**: No `bigint` on wire `id` field
- **G10**: No `src/generated/Schema.ts` filename
- **G11**: **Library/public API forbids**: browser launching, profile mgmt, screencast, Fetch interception, `Page.pdf`, `captureScreenshot`, `Emulation.*`, Worker/SW typed helpers, Tracing/HeapProfiler/Profiler/IO, reconnection w/ state replay, TLS/proxy/auth config, Firefox/WebKit, dialog/Security/Bluetooth/DeviceOrientation/DeviceAccess helpers. **EXEMPT**: smoke scripts (`scripts/smoke.ts --test-*`) and Final Verification Wave (F3) MAY spawn Chromium as a child process via `NodeChildProcessSpawner` purely as a test harness — the spawned process never leaks into the library's public API or runtime layer. Test-only browser invocations are NOT a library capability.
- **G12**: No `Schema.TaggedRequest` (not in Effect v4)
- **G13**: No services as function arguments — yield from context inside effect bodies
- **G14**: No `"_tag" in error` probing — use `Effect.catchTag`/`catchTags`
- **G15**: No `Effect.fnUntraced` if a span is needed — use `Effect.fn`; default everything else to `fnUntraced`
- **G16**: No `Layer.orDie` on intermediate layers — only on final live compositions
- **G17**: Codegen template must NEVER emit `Schema.Unknown`; map CDP `any`/untyped object → `Schema.Json`
- **G18**: `CdpConfig.eventBufferSize` validated `≥ 16` via `Schema.brand`/`filter`
- **G19**: Codegen must NEVER emit `export default` — named exports only
- **G20**: `send()` after Scope close fails immediately with `CdpDisconnected` — `Ref<boolean>` closed-flag check before enqueuing
- **G21 (scope-creep)**: Codegen emits ONLY schema + JSDoc `@deprecated`/`@experimental` — no `Equivalence`, no `Order`, no `@example`, no `readonly` proliferation beyond Effect defaults
- **G22 (scope-creep)**: ONLY 7 v1 helpers — no `DOM.waitForSelector`, no `DOM.screenshot`, no `DOM.evaluate` sugar, no `Page.pdf`, no extras
- **G23 (scope-creep)**: `Target.autoAttach` is flat-mode + recursive — no depth filter, no type whitelist, no predicate
- **G24 (scope-creep)**: HttpDiscovery = single-shot only — no retry, no polling, no health-check loop
- **G25 (scope-creep)**: `CdpProtocolError.message: Schema.String`, `.code: Schema.Number` — no literal-union enumeration of CDP error codes
- **G26 (scope-creep)**: ONE global `cdp_events_dropped_total` counter — no per-domain/per-method cardinality split
- **G27 (Effect v4)**: Services MUST use `Context.Service<Self, { readonly method: ... }>()("Identifier")` with implementation provided separately via `Layer.effect(Service, Effect.gen(function*(){ ... }))`. NEVER use `Effect.Service` (does not exist in Effect v4). Supersedes inline samples in T13, T14, T15, T19, T20, T22.
- **G28 (frame routing)**: Inbound frame classification precedence is STRICT: (a) HAS `id` AND (HAS `error` OR HAS `result`) → response (error wins over result); (b) ELSE HAS `method` (with or without `id`) AND NEITHER `result` NOR `error` → event; (c) ELSE → CdpDecodeError. Frame `{id,method,result,error}` is a response, NOT an event. Supersedes T18 routing rules.
- **G29 (atomic pending)**: PendingMap state MUST be a SINGLE `Ref<{ state: "open"; pending: HashMap<CdpRequestId, Entry> } | { state: "closed"; reason: CdpDisconnected["reason"] }>`. `register` and `drainAll`/`drainSession` MUST be implemented as one `Ref.modify` each (no Ref<boolean> closed-flag race). Single-winner ops: `complete | fail | timeout | cancel` each return `boolean` indicating whether they won the slot. Late wins are dropped (with metric). Supersedes T14 spec.
- **G30 (single-winner send)**: `send()` MUST wrap the deferred-await with `Effect.ensuring(pending.cancel(id))` so caller interruption removes the pending entry. `Effect.timeoutFail` MUST cooperate via single-winner cancel — if timeout wins, response arriving later is a no-op + metric increment. Supersedes T19 timeout cleanup.
- **G31 (detach semantics)**: `Target.detachedFromTarget` MUST be decoded; the affected session is `params.sessionId`, NOT the top-level wire `sessionId` (which is the parent dispatcher session). SessionRegistry MUST maintain tombstones: detach-before-attach records sessionId as `Tombstone`; later `attachedToTarget` for a tombstoned sessionId is rejected with logWarning (not silently resurrected). Supersedes T18 detach handling + T20 attach idempotency.
- **G32 (backpressure test reality)**: `PubSub.dropping(N)` only drops when an active subscriber's per-subscriber backlog fills (Effect PubSub.ts:1483-1497). T33 `--test-backpressure` MUST use a deliberately-stalled active subscriber (not absent subscriber). Multi-session isolation: if one slow subscriber must not stall others, use per-session/per-subscriber dropping queues fanned out from a central inbound queue — but v1 keeps the single global PubSub.dropping with documented "one slow subscriber affects all" tradeoff. Supersedes T13 design + T33 test.
- **G33 (AC existence-check)**: All "forbidden pattern" ACs of the form `grep -E 'BadPattern' src/foo.ts → exit 1` MUST be rewritten to `test -f src/foo.ts && ! grep -E 'BadPattern' src/foo.ts` so a missing file fails the AC (not vacuously passes). Supersedes grep-style ACs in T8, T12, T13, T18, T19, T28.
- **G34 (typed send API)**: `Cdp.send` MUST accept a Command bundle from `src/generated/<Domain>.ts` (emitted by T8b), NOT a raw method string. Signature: `send<C extends { method: string; params: Schema.Schema<any>; result: Schema.Schema<any> }>(cmd: C, params: Schema.Schema.Type<C["params"]>, opts?: { sessionId?: SessionId; timeout?: Duration }): Effect<Schema.Schema.Type<C["result"]>, CdpError>`. Encoder uses `cmd.params` on outbound, decoder uses `cmd.result` on inbound. The dispatcher (T19) low-level path takes `(method: string, encodedParams: unknown)` as the escape-hatch under the typed API — NOT exposed publicly. Supersedes T19/T22 signature wording.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification agent-executed.

### Test Decision

- **Infrastructure exists**: NO (greenfield) — Wave 1 sets up `bun:test` config
- **Automated tests**: BOTH — codegen unit tests (TDD-friendly) + smoke integration scripts
- **Framework**: `bun:test` (built-in, no extra deps)
- **Coverage island**: `scripts/codegen/**` ≥80% line coverage (AGENTS.md rule)
- **Smoke scripts**: 7 sub-tests (default + 6 `--test-*` flags) run against real Chromium

### QA Policy

- Every task includes Playwright/curl/tmux scenarios with concrete selectors, data, assertions
- Evidence saved to `.omo/evidence/task-{N}-{slug}.{ext}`
- Real Chromium required for smoke; codegen tests pure (no browser)
- Library-mode QA: import generated schemas in throwaway `bun -e '...'` invocations, assert decode shape

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 — Foundation (7 parallel, no deps):
├── T1  Project scaffolding (package.json, tsconfig, bun config, .gitignore)
├── T2  Core types/brands (CdpRequestId, SessionId, TargetId, CdpConfig)
├── T3  4 typed errors (Schema.TaggedErrorClass)
├── T4  HttpDiscovery layer (/json/version|list|new|close)
├── T5  Codegen scaffolding (JSON loader, AST types, fixtures)
├── T6  Shared.ts baseline (manual cross-domain types)
└── T7  Effect v4 LLMS.md skim + capture conventions cheatsheet (internal doc)

Wave 2 — Core Modules (9 parallel, depends Wave 1):
├── T8  Codegen schema emitter (pure fn)                    [deps: T5]
├── T9  Codegen $ref resolver + cycle → Shared extraction   [deps: T5, T6]
├── T10 Codegen recursive detector + Schema.suspend wrap    [deps: T5]
├── T11 Codegen JSDoc emitter (deprecated/experimental)     [deps: T5]
├── T8b Codegen Command + Event bundle emitter            [deps: T5, T8]
├── T12 Socket bridge (Queue.unbounded + Socket.run)        [deps: T2, T3]
├── T13 PubSub events bus + drop Metric + rate-limit warn   [deps: T2, T3]
├── T14 PendingMap (Ref<HashMap>) + atomic drain primitive  [deps: T2, T3]
└── T15 Codegen unit tests (tests/codegen/)                 [deps: T8, T9, T10, T11]

Wave 3 — Dispatcher + Generated (6 parallel, depends Wave 2):
├── T16 Run codegen → src/generated/*.ts (AC3 verify)       [deps: T8-T11, T8b]
├── T17 check-codegen.ts satisfies ProtocolMapping (AC6)    [deps: T16]
├── T18 Inbound dispatcher (route by method, error wins)    [deps: T12, T13, T14]
├── T19 Outbound send() (id, omit absent, timeout cleanup)  [deps: T14]
├── T20 SessionRegistry (idempotent attach/detach)          [deps: T13, T14]
└── T21 Scope finalizer ordering (drain → close socket)     [deps: T12, T14]

Wave 4 — Service + Helpers (7 parallel, depends Wave 3):
├── T22 Cdp service Layer composition                       [deps: T18-T21]
├── T23 Session lens (Cdp.session(id).send / .events)       [deps: T22]
├── T24 Helper: Page.goto + waitForLoad                     [deps: T23, T16]
├── T25 Helper: Network.waitForResponse(string|RegExp)      [deps: T23, T16]
├── T26 Helper: Runtime.evaluate (caller-supplied Schema)   [deps: T23, T16]
├── T27 Helper: DOM.querySelector + click                   [deps: T23, T16]
└── T28 Helper: Target.attach + auto-attach (recursive)     [deps: T23, T16]

Wave 5 — Smoke Scripts (7 parallel, depends Wave 4):
├── T29 scripts/smoke.ts default (AC1)                      [deps: T22-T28]
├── T30 smoke --test-disconnect (AC4)                       [deps: T22]
├── T31 smoke --test-detach (AC5)                           [deps: T22, T23]
├── T32 smoke --test-timeout (AC10)                         [deps: T19]
├── T33 smoke --test-backpressure (AC8)                     [deps: T13]
├── T34 smoke --test-multi-session (AC9)                    [deps: T23, T28]
├── T35 smoke --test-discovery (AC11)                       [deps: T4]
└── T36 Helper: Form (type, fill, press)                    [deps: T23, T27]

Wave 6 — Docs (sequential after Wave 5):
└── T37 README + AGENTS.md (analysis methodology, never-invent, debundle/latest)

Wave FINAL — 4 parallel reviews, then user okay:
├── F1 Plan compliance audit (oracle)
├── F2 Code quality review (unspecified-high)
├── F3 Real manual QA via 7 smoke sub-tests (unspecified-high)
└── F4 Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

Critical Path: T1 → T2 → T14 → T18 → T22 → T29 → F1-F4 → user okay
Parallel Speedup: ~75% vs sequential (7-wide Waves 1,2,4,5)
Max Concurrent: 9 (Wave 2)

### Agent Dispatch Summary

- **Wave 1**: 7 — T1→`quick`, T2-T7→`quick`
- **Wave 2**: 9 — T8-T11,T8b,T15→`deep` (codegen logic), T12-T14→`deep` (Effect concurrency)
- **Wave 3**: 6 — T16→`quick`, T17→`deep`, T18-T21→`deep`
- **Wave 4**: 7 — T22-T23→`deep`, T24-T28→`unspecified-high`
- **Wave 5**: 7 — T29-T36→`unspecified-high`
- **Wave 6**: 1 — T37→`writing`
- **FINAL**: 4 — F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs

> **HYPERPLAN ADVERSARIAL REVIEW PATCHES (post-Momus)**: G27-G33 above introduce binding corrections to several task inline code samples. When a task body shows the old pattern (Effect.Service, Schema.JsonValue, Queue.unsafeOffer, etc.), apply the new guardrail. The mechanical s/// renames are already applied throughout (Schema.TaggedError → TaggedErrorClass, Queue.unsafeOffer → offerUnsafe, PubSub.offer → publishUnsafe, Schema.JsonValue → Schema.Json). The structural rewrites (G27 service pattern, G28 routing, G29 atomic pending, G30 single-winner send, G31 detach tombstones, G32 backpressure test reality, G33 AC existence-check) are NOT mechanically applied to every task code block — executors MUST read G27-G33 and override stale inline patterns accordingly.

- [x] 1. Project scaffolding

  **What to do**:
  - Create `package.json` (name `effect-cdp`, type `module`, `engines.node >=20`, `engines.bun >=1.1`), scripts: `ts:check`, `codegen`, `check-codegen`, `test`, `test:unit`, `smoke`
  - Add deps: `effect@beta`, `@effect/platform`, `@effect/platform-node`, `@effect/platform-bun`, `devtools-protocol`
  - Add devDeps: `typescript@^5.6`, `@types/bun`
  - `tsconfig.json` strict (Effect v4 baseline: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module: NodeNext`, `target: ES2022`, `lib: ['ES2023','DOM']`)
  - `.gitignore` (node_modules, dist, .omo/evidence/, \*.log)
  - `bunfig.toml` minimal (test preload if needed)
  - Empty stubs: `src/index.ts` (re-exports skeleton), `scripts/codegen.ts` (stub), `scripts/smoke.ts` (stub)

  **Must NOT do**:
  - No `tsconfig.json` `composite`, no project references (single package)
  - No `prepublish` hooks (greenfield, no npm publish in v1)
  - No barrel re-exports beyond `src/index.ts` and `src/generated/index.ts`

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: pure config wiring, no domain logic
  - **Skills**: [`effect-ts`] — Reason: tsconfig + package.json must match Effect v4 baseline (module: NodeNext, beta channel)
  - **Skills Evaluated but Omitted**: `turborepo` (single-package), `next-best-practices` (not a Next.js app)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2-T7)
  - **Blocks**: T2, T3, T4, T5, T6, T7
  - **Blocked By**: None (Wave 1 start)

  **References**:
  - Pattern: `.repos/effect/packages/effect/package.json` — Effect v4 beta channel + workspace layout
  - Pattern: `.repos/effect/tsconfig.base.json` — strict tsconfig baseline
  - External: `https://github.com/ChromeDevTools/devtools-protocol#installation` — devtools-protocol package layout (`json/` dir + `types/` dir)
  - Repo: `/Users/yovanoc/Projects/effect-cdp/AGENTS.md` — vendored repos rule, Effect v4 conventions

  **Acceptance Criteria**:
  - [ ] `bun install` exits 0
  - [ ] `bun run ts:check` exits 0 on empty stubs
  - [ ] `ls node_modules/devtools-protocol/json/{browser_protocol,js_protocol}.json` both exist
  - [ ] `package.json` lists exactly the deps above (no `chrome-remote-interface`, no `puppeteer`)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Fresh install + typecheck succeeds
    Tool: Bash
    Preconditions: empty repo (only AGENTS.md, .omo/, README.md exist)
    Steps:
      1. `cd /Users/yovanoc/Projects/effect-cdp && bun install` → exit 0
      2. `bun run ts:check` → exit 0, stdout empty
      3. `cat node_modules/devtools-protocol/package.json | jq -r .version` → non-empty string
    Expected Result: Both commands exit 0, devtools-protocol installed
    Failure Indicators: missing devtools-protocol, ts errors on empty stubs, missing scripts in package.json
    Evidence: .omo/evidence/task-1-install-typecheck.txt

  Scenario: Forbidden deps rejected
    Tool: Bash
    Preconditions: package.json written
    Steps:
      1. `grep -E '(chrome-remote-interface|puppeteer|playwright)' package.json` → exit 1 (no matches)
    Expected Result: exit code 1 (grep finds nothing)
    Evidence: .omo/evidence/task-1-no-forbidden-deps.txt
  ```

  **Commit**: YES
  - Message: `chore(scaffold): bootstrap effect-cdp package with Effect v4 beta + devtools-protocol`
  - Files: `package.json`, `bun.lockb`, `tsconfig.json`, `.gitignore`, `bunfig.toml`, `src/index.ts`, `scripts/codegen.ts`, `scripts/smoke.ts`
  - Pre-commit: `bun run ts:check`

- [x] 2. Core types and brands (CdpConfig validated)

  **What to do**:
  - `src/types.ts`: branded types via `Schema.brand`:
    - `CdpRequestId = Schema.Number.pipe(Schema.brand('CdpRequestId'))` (NOT bigint)
    - `SessionId = Schema.String.pipe(Schema.brand('SessionId'))`
    - `TargetId = Schema.String.pipe(Schema.brand('TargetId'))`
    - `FrameId = Schema.String.pipe(Schema.brand('FrameId'))`
  - `src/CdpConfig.ts`: `Schema.Struct({ webSocketDebuggerUrl: Schema.String, eventBufferSize: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(16)), defaultTimeout: Schema.optional(Schema.DurationFromMillis) }).annotate({ identifier: 'CdpConfig' })`
  - All schemas `.annotate({ identifier: '...' })`
  - Export `makeUnsafe` builders for IDs (per AGENTS.md: no `as` casts)

  **Must NOT do**:
  - No `bigint` (G9)
  - No `as` casts (use `Schema.brand` constructors)
  - No `Schema.Unknown` (G1)
  - No defaults baked into `CdpConfig` — caller must provide explicitly (Effect Config pattern)

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: small pure schema module
  - **Skills**: [`effect-ts`] — Reason: brand patterns + Schema.annotate identifier rule

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 1 (with T1, T3-T7)
  - **Blocks**: T3, T4, T12, T13, T14, T18, T19
  - **Blocked By**: T1 (needs package.json + tsconfig)

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Brand.ts` — branded number/string
  - Pattern: `.repos/effect/packages/effect/src/Schema.ts` — `Schema.brand`, `Schema.int`, `Schema.greaterThanOrEqualTo`
  - Repo: AGENTS.md — entity IDs branded with Schema.brand, `makeUnsafe()` constructor, never `as`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] `bun -e "import { CdpConfig } from './src/CdpConfig.ts'; import { Schema } from 'effect'; const r = Schema.decodeUnknownSync(CdpConfig)({webSocketDebuggerUrl:'ws://x',eventBufferSize:8}); console.log('FAIL: should reject 8'); process.exit(1);" 2>&1 | grep -q 'greaterThanOrEqualTo'` — schema rejects `< 16`
  - [ ] `bun -e "import { CdpConfig } from './src/CdpConfig.ts'; import { Schema } from 'effect'; Schema.decodeUnknownSync(CdpConfig)({webSocketDebuggerUrl:'ws://x',eventBufferSize:256}); console.log('OK')" | grep -q 'OK'` — schema accepts ≥16

  **QA Scenarios**:

  ```
  Scenario: CdpConfig validates eventBufferSize ≥ 16
    Tool: Bash
    Preconditions: src/CdpConfig.ts exists
    Steps:
      1. Run reject test (see AC above) → grep matches
      2. Run accept test → 'OK' printed
    Expected Result: 16-rule enforced
    Evidence: .omo/evidence/task-2-config-validation.txt

  Scenario: Branded ID prevents type confusion
    Tool: Bash
    Preconditions: src/types.ts exports SessionId + TargetId brands
    Steps:
      1. Create temp file `/tmp/brand-check.ts` calling a fn typed `(s: SessionId) => void` with a raw string
      2. `bunx tsc --noEmit /tmp/brand-check.ts` → exit non-zero with branded type error
    Expected Result: TS rejects raw string assigned to SessionId
    Evidence: .omo/evidence/task-2-brand-rejects-string.txt
  ```

  **Commit**: YES
  - Message: `feat(types): branded ids and validated CdpConfig schema`
  - Files: `src/types.ts`, `src/CdpConfig.ts`
  - Pre-commit: `bun run ts:check`

- [x] 3. Four typed errors (Schema.TaggedErrorClass)

  **What to do**:
  - `src/errors.ts`:
    - `class CdpDisconnected extends Schema.TaggedErrorClass<CdpDisconnected>()('CdpDisconnected', { reason: Schema.Literals('SocketClosed','ScopeFinalized','TargetDetached','PeerKilled') }) {}`
    - `class CdpTimeout extends Schema.TaggedErrorClass<CdpTimeout>()('CdpTimeout', { method: Schema.String, requestId: CdpRequestId, durationMs: Schema.Number }) {}`
    - `class CdpDecodeError extends Schema.TaggedErrorClass<CdpDecodeError>()('CdpDecodeError', { raw: Schema.String, parseError: Schema.String }) {}`
    - `class CdpProtocolError extends Schema.TaggedErrorClass<CdpProtocolError>()('CdpProtocolError', { code: Schema.Number, message: Schema.String, method: Schema.String, sessionId: Schema.optional(SessionId) }) {}`
  - All annotated with `identifier`

  **Must NOT do**:
  - No 5th error (G5)
  - No literal-union for CdpProtocolError code (G25) — keep `Schema.Number`
  - No `Schema.Unknown` in `parseError` field — `Schema.String` (pre-stringified via `Cause.pretty` if needed)
  - No `Error.message` style helpers — define on the error itself

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: small schema file
  - **Skills**: [`effect-ts`, `error-handling`] — Reason: TaggedError conventions + reason literal pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 1
  - **Blocks**: T12, T13, T14, T18, T19, T20
  - **Blocked By**: T2 (needs CdpRequestId + SessionId)

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Schema.ts` — `Schema.TaggedErrorClass` examples
  - Repo: AGENTS.md — `Schema.TaggedErrorClass` only, `reason` field uses `Schema.Literals(...)` PascalCase

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] `bun -e "import * as E from './src/errors.ts'; const e = new E.CdpTimeout({method:'X',requestId:1 as any,durationMs:100}); console.log(e._tag)" | grep -q 'CdpTimeout'`
  - [ ] `grep -rE '_tag.*in.*error|instanceof.*CdpDisconnected' src/ scripts/` → exit 1 (no probe pattern)

  **QA Scenarios**:

  ```
  Scenario: All 4 errors construct and pattern-match
    Tool: Bash
    Preconditions: src/errors.ts exists
    Steps:
      1. Construct each error via `new` with valid args
      2. Verify `._tag` equals tag string
      3. Verify `Effect.catchTag('CdpTimeout', ...)` compiles in temp file
    Expected Result: all 4 tags work, no TS errors
    Evidence: .omo/evidence/task-3-errors-construct.txt
  ```

  **Commit**: YES
  - Message: `feat(errors): four typed CDP errors (Disconnected/Timeout/Decode/Protocol)`
  - Files: `src/errors.ts`
  - Pre-commit: `bun run ts:check`

- [x] 4. HttpDiscovery service (/json/version|list|new|close)

  **What to do**:
  - `src/discovery/HttpDiscovery.ts`: `class HttpDiscovery extends Effect.Service<HttpDiscovery>()('HttpDiscovery', { effect: ... })`
  - Methods: `version()`, `list()`, `newTab(url?: string)`, `close(targetId: TargetId)`
  - Use `@effect/platform/HttpClient` with `HttpClientRequest.get/put`
  - Decode responses with Schema (`CdpVersionInfo`, `CdpTargetInfo`)
  - Base URL from config: `http://<host>:<port>` derived from `webSocketDebuggerUrl`
  - Single-shot only (G24) — no retry, no polling

  **Must NOT do**:
  - No retry (G24)
  - No `HttpClient.retry`/`HttpClient.repeat` schedules
  - No health-check loop
  - No browser-launch detection
  - No `Schema.Unknown` in response decoders

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: Effect Service + HttpClient wiring
  - **Skills**: [`effect-ts`, `reliability-patterns`] — Reason: Effect.Service pattern + single-shot HTTP discipline (no creep into retry)

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 1
  - **Blocks**: T35 (smoke --test-discovery)
  - **Blocked By**: T2 (TargetId), T3 (errors for decode failures via CdpDecodeError)

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/unstable/http/HttpClient.ts` — base client
  - Pattern: `.repos/effect/packages/effect/src/unstable/http/HttpClientRequest.ts` — `get`, `put`
  - External: `https://chromedevtools.github.io/devtools-protocol/#endpoints` — `/json/version`, `/json/list`, `/json/new`, `/json/close/<targetId>` response shapes

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] `grep -E '\.retry|\.repeat\b' src/discovery/HttpDiscovery.ts` → exit 1
  - [ ] Service Layer typed as `Layer.Layer<HttpDiscovery>` (no errors in channel)

  **QA Scenarios**: (executable in AC11 — covered by T35 smoke)

  ```
  Scenario: Decode rejects malformed /json/version response
    Tool: Bash + bun -e
    Preconditions: HttpDiscovery exports CdpVersionInfo schema
    Steps:
      1. `bun -e "import {Schema} from 'effect'; import {CdpVersionInfo} from './src/discovery/HttpDiscovery.ts'; Schema.decodeUnknownSync(CdpVersionInfo)({})" 2>&1 | grep -q 'is missing'`
    Expected Result: decode throws missing-field error
    Evidence: .omo/evidence/task-4-decode-rejects-empty.txt
  ```

  **Commit**: YES
  - Message: `feat(discovery): single-shot HTTP discovery for /json endpoints`
  - Files: `src/discovery/HttpDiscovery.ts`
  - Pre-commit: `bun run ts:check`

- [x] 5. Codegen scaffolding (JSON loader + AST types + fixtures)

  **What to do**:
  - `scripts/codegen/loadProtocol.ts`: reads `node_modules/devtools-protocol/json/{browser,js}_protocol.json`, merges domains, returns `Protocol` AST
  - `scripts/codegen/types.ts`: TS types for `Domain`, `Command`, `Event`, `TypeDef`, `Parameter`, `PropertyRef` (mirror the protocol JSON shape minus comments)
  - `scripts/codegen/sort.ts`: deterministic sort — domains alphabetical, types alphabetical within domain, properties in declared order preserved
  - `tests/codegen/fixtures/`: 3 hand-written mini protocol JSON files (simple, recursive, cross-domain $ref)
  - `scripts/codegen.ts` orchestrator stub (calls T8-T11 later)

  **Must NOT do**:
  - No emission logic in this task (T8 owns)
  - No reading from anywhere other than `node_modules/devtools-protocol/json/`
  - No `Schema.Unknown` in AST types (G17)
  - No `any` in AST types — use `unknown` and refine via type guards

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: AST design decisions ripple to all downstream codegen tasks
  - **Skills**: [`effect-ts`] — Reason: pure function discipline (codegen is sync, no Effect)

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 1
  - **Blocks**: T8, T9, T10, T11, T15, T16
  - **Blocked By**: T1 (needs devtools-protocol installed)

  **References**:
  - External: `https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json` — JSON shape
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/` — official docs for cross-reference
  - Pattern: `.repos/effect/packages/effect/src/SchemaAST.ts` — example of an internal AST module

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors on `scripts/codegen/**`
  - [ ] `bun -e "import {loadProtocol} from './scripts/codegen/loadProtocol.ts'; const p = loadProtocol(); console.log(p.domains.length)"` → prints number > 40
  - [ ] Fixtures load without error: `bun -e "import {loadFixture} from './tests/codegen/fixtures/loader.ts'; loadFixture('simple')"`

  **QA Scenarios**:

  ```
  Scenario: Protocol loads deterministically (same hash across runs)
    Tool: Bash
    Preconditions: scripts/codegen/loadProtocol.ts exists
    Steps:
      1. `bun -e "..." | sha256sum > /tmp/h1`
      2. Run again → `> /tmp/h2`
      3. `diff /tmp/h1 /tmp/h2` → exit 0
    Expected Result: byte-identical AST output across runs (no Date.now, no Map iteration order)
    Evidence: .omo/evidence/task-5-deterministic-load.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): protocol JSON loader and AST types`
  - Files: `scripts/codegen/{loadProtocol,types,sort}.ts`, `tests/codegen/fixtures/*.json`, `tests/codegen/fixtures/loader.ts`, `scripts/codegen.ts` (stub)
  - Pre-commit: `bun run ts:check`

- [x] 6. Shared.ts baseline (manual cross-domain types)

  **What to do**:
  - `src/generated/Shared.ts` initial hand-written file with `// AUTO-GENERATED ANCHOR` markers
  - Pre-declare 3-5 known cross-domain shared types that we already know cycle: `Runtime.RemoteObject`, `DOM.BackendNodeId`, `Page.FrameId`
  - Codegen will append/regenerate the rest — this is the seed file so T16 can find its target
  - Annotate each with `identifier`
  - Document the extraction rule at top of file: "If type A references B and B references A across files → both move here"

  **Must NOT do**:
  - No domain-specific helpers (only schemas)
  - No business logic
  - No imports from non-generated files

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: small seed file
  - **Skills**: [`effect-ts`] — Reason: `Schema.suspend` recursion + identifier annotations

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 1
  - **Blocks**: T9, T16
  - **Blocked By**: T1 (needs tsconfig)

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Schema.ts` — `Schema.suspend` with explicit type annotation
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-RemoteObject` — RemoteObject shape

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Each schema has `.annotate({ identifier: 'X' })` — verify via `grep -c '\.annotate' src/generated/Shared.ts` matches type count

  **QA Scenarios**:

  ```
  Scenario: Decode succeeds for sample RemoteObject
    Tool: Bash
    Steps:
      1. `bun -e "import {RemoteObject} from './src/generated/Shared.ts'; import {Schema} from 'effect'; const v = Schema.decodeUnknownSync(RemoteObject)({type:'number',value:42}); console.log(v.type)" | grep -q 'number'`
    Expected Result: prints 'number'
    Evidence: .omo/evidence/task-6-shared-decode.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): manual Shared.ts seed for cross-domain types`
  - Files: `src/generated/Shared.ts`
  - Pre-commit: `bun run ts:check`

- [x] 7. Internal Effect v4 conventions cheatsheet

  **What to do**:
  - `.omo/notes/effect-v4-cheatsheet.md` (NOT in src/, INTERNAL only)
  - Capture: `Effect.fnUntraced` vs `Effect.fn` (when to use which), `Schema.TaggedErrorClass` minimal example, `Layer.orDie` placement rule, `PubSub.dropping` semantics + return value, `Scope` finalizer LIFO ordering, `Socket.run` callback contract, `Queue.offerUnsafe` vs `Queue.offer` sync-safety
  - Source: `.repos/effect/LLMS.md` (skim, distill)
  - 1 page max — reference for executors of T12-T22

  **Must NOT do**:
  - No new patterns invented
  - No examples — only API quick-reference
  - Not in `src/` (internal only)

  **Recommended Agent Profile**:
  - **Category**: `writing` — Reason: documentation distillation
  - **Skills**: [`effect-ts`] — Reason: distill LLMS.md

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 1
  - **Blocks**: (none functionally) — advisory for downstream agents
  - **Blocked By**: None

  **References**:
  - Repo: `.repos/effect/LLMS.md` — must read per AGENTS.md

  **Acceptance Criteria**:
  - [ ] File exists at `.omo/notes/effect-v4-cheatsheet.md`
  - [ ] Word count ≤ 1000 (one page max)
  - [ ] Contains all 7 topics listed under What to do

  **QA Scenarios**:

  ```
  Scenario: All 7 topics present
    Tool: Bash
    Steps:
      1. `for t in fnUntraced TaggedError 'Layer.orDie' 'PubSub.dropping' 'Scope.*LIFO' 'Socket.run' 'Queue.offerUnsafe'; do grep -q "$t" .omo/notes/effect-v4-cheatsheet.md || echo MISSING $t; done` → no MISSING lines
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-7-cheatsheet-topics.txt
  ```

  **Commit**: YES
  - Message: `docs: internal Effect v4 conventions cheatsheet`
  - Files: `.omo/notes/effect-v4-cheatsheet.md`
  - Pre-commit: none

- [x] 8. Codegen schema emitter (pure function)

  **What to do**:
  - `scripts/codegen/emit/schema.ts`: pure fn `emitTypeDef(td: TypeDef): string` produces Effect `Schema.*` source
  - Map CDP types: `string` → `Schema.String`; `integer`/`number` → `Schema.Number`; `boolean` → `Schema.Boolean`; `array` → `Schema.Array(item)`; `object` w/ `properties` → `Schema.Struct({...})`; `object` w/o `properties` → `Schema.Json` (G17, NEVER Schema.Unknown); `enum` → `Schema.Literals(...)`
  - Optional fields: `Schema.optional(X)` when CDP marks `optional: true`
  - Brand IDs at codegen time: detect `$ref` to known ID types → import branded type from `src/types.ts`
  - Emit `.annotate({ identifier: '<Domain>.<TypeName>' })` for every named schema
  - Named exports only (G19)

  **Must NOT do**:
  - No `Schema.Unknown` ever (G1, G17)
  - No `export default` (G19)
  - No `as` casts in emitted code (G3)
  - No JSDoc except `@deprecated`/`@experimental` (G21 — T11 owns)
  - No `Equivalence`, no `Order`, no `@example` (G21)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: AST → source transformation, every CDP type shape
  - **Skills**: [`effect-ts`] — Reason: precise Schema API knowledge

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T15, T16
  - **Blocked By**: T5 (needs AST types)

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Schema.ts` — every constructor used
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Page/#type-Frame` — example complex type

  **Acceptance Criteria**:
  - [ ] Pure function (no I/O, no side effects) — verified by `grep -E 'readFile|fetch|process\.|console\.' scripts/codegen/emit/schema.ts` → exit 1
  - [ ] Snapshot test passes (T15 owns)
  - [ ] Output for sample fixture matches expected golden file

  **QA Scenarios**:

  ```
  Scenario: Emit simple struct type
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitTypeDef} from './scripts/codegen/emit/schema.ts'; console.log(emitTypeDef({id:'Foo',type:'object',properties:[{name:'x',type:'string'}]}))" | grep -E 'Schema.Struct.*Schema.String'`
    Expected Result: output contains both `Schema.Struct` and `Schema.String`
    Evidence: .omo/evidence/task-8-emit-simple.txt

  Scenario: Object without properties → Schema.Json (NOT Unknown)
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitTypeDef} from './scripts/codegen/emit/schema.ts'; const s = emitTypeDef({id:'Blob',type:'object'}); if (s.includes('Schema.Unknown')) { console.log('FAIL'); process.exit(1); } if (!s.includes('Schema.Json')) { console.log('FAIL'); process.exit(1); } console.log('OK')" | grep -q OK`
    Expected Result: emits `Schema.Json`, never `Schema.Unknown`
    Evidence: .omo/evidence/task-8-no-unknown.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): pure schema emitter from CDP TypeDef`
  - Files: `scripts/codegen/emit/schema.ts`
  - Pre-commit: `bun run ts:check`

- [x] 8b. Codegen Command + Event bundle emitter (request-response binding)

  **What to do**:
  - `scripts/codegen/emit/command.ts`: pure fn `emitCommand(domain: string, cmd: CommandDef): string` produces:
    ```ts
    export const <commandName> = {
      method: "<Domain>.<commandName>" as const,
      params: Schema.Struct({ ... }).annotate({ identifier: '<Domain>.<commandName>.params' }),
      result: Schema.Struct({ ... }).annotate({ identifier: '<Domain>.<commandName>.result' })
    } as const
    ```
  - If command has no `parameters[]`: `params: Schema.Struct({})` (NOT omitted — the dispatcher omits the wire key per T19, but the schema slot must exist for the type machinery)
  - If command has no `returns[]`: `result: Schema.Void` (commands like `Page.enable` return `{}`)
  - `scripts/codegen/emit/event.ts`: pure fn `emitEvent(domain: string, evt: EventDef): string` produces:
    ```ts
    export const <eventName> = {
      method: "<Domain>.<eventName>" as const,
      params: Schema.Struct({ ... }).annotate({ identifier: '<Domain>.<eventName>.params' })
    } as const
    ```
  - No `result` field on events (events are one-way)
  - These bundles enable typed send: `Cdp.send(Page.navigate, {url})` infers params from `Page.navigate.params` and result from `Page.navigate.result`
  - Emit a single `Command` and `Event` brand type union per domain for typecheck guards in T22:
    ```ts
    export type AnyCommand = typeof navigate | typeof reload | typeof enable | ...
    export type AnyEvent = typeof loadEventFired | typeof frameNavigated | ...
    ```

  **Must NOT do**:
  - No `Schema.TaggedRequest` wrapping (G12 — doesn't exist in v4)
  - No `Rpc.Tag` wrapping (G27 — we're not using Rpc)
  - No `Schema.Unknown` (G1)
  - No `as any` (G3) — use `as const` for method literal narrowing only
  - No mixing commands and events in same export (separate `<commandName>` from `<eventName>`)
  - No `export default` (G19)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: type-level binding correctness across params/result
  - **Skills**: [`effect-ts`] — Reason: Schema generics + `as const` literal narrowing

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2 (alongside T8-T11)
  - **Blocks**: T15 (unit tests), T16 (full codegen run), T17 (check-codegen satisfies needs both params + result + method binding)
  - **Blocked By**: T5 (AST types), T8 (struct emitter — commands reuse `emitTypeDef` for nested types)

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-navigate` — sample command shape (parameters[], returns[])
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Page/#event-loadEventFired` — sample event shape (parameters[] only)
  - Pattern: `node_modules/devtools-protocol/types/protocol-mapping.d.ts` — `Commands` and `Events` mappings (this is what T17 satisfies-asserts against)

  **Acceptance Criteria**:
  - [ ] `test -f scripts/codegen/emit/command.ts && bun run ts:check` zero errors
  - [ ] `test -f scripts/codegen/emit/event.ts && bun run ts:check` zero errors
  - [ ] Command bundle `as const` narrowing works: `Page.navigate.method` types as `"Page.navigate"` literal (not `string`)
  - [ ] Empty params command → `Schema.Struct({})`, NOT omitted
  - [ ] Empty returns command → `result: Schema.Void`
  - [ ] Event has NO `result` field (compile-time guard)
  - [ ] `grep -E 'Schema\.TaggedRequest|Rpc\.Tag' scripts/codegen/emit/{command,event}.ts` → exit 1

  **QA Scenarios**:

  ```
  Scenario: Command bundle types params + result independently
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitCommand} from './scripts/codegen/emit/command.ts'; const s = emitCommand('Page', {name:'navigate', parameters:[{name:'url',type:'string'}], returns:[{name:'frameId',$ref:'FrameId'}]}); console.log(s)" | tee /tmp/c8b.txt`
      2. `grep -q 'method: "Page.navigate" as const' /tmp/c8b.txt`
      3. `grep -q 'params: Schema.Struct' /tmp/c8b.txt`
      4. `grep -q 'result: Schema.Struct' /tmp/c8b.txt`
      5. `! grep -q 'TaggedRequest\|Rpc\.' /tmp/c8b.txt`
    Expected Result: emitted source has all three fields with `as const` narrowing, no forbidden patterns
    Evidence: .omo/evidence/task-8b-command-bundle.txt

  Scenario: Empty params → Schema.Struct({}); empty returns → Schema.Void
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitCommand} from './scripts/codegen/emit/command.ts'; console.log(emitCommand('Page', {name:'enable', parameters:[], returns:[]}))" | tee /tmp/c8b-empty.txt`
      2. `grep -q 'params: Schema.Struct({})' /tmp/c8b-empty.txt`
      3. `grep -q 'result: Schema.Void' /tmp/c8b-empty.txt`
    Expected Result: empty params slot still emitted as `Struct({})`; empty returns becomes `Schema.Void`
    Evidence: .omo/evidence/task-8b-empty.txt

  Scenario: Event has no result field
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitEvent} from './scripts/codegen/emit/event.ts'; const s = emitEvent('Page', {name:'loadEventFired', parameters:[{name:'timestamp',type:'number'}]}); if (s.includes('result:')) process.exit(1); console.log('OK')" | grep -q OK`
    Expected Result: emitted event source contains no `result:` field
    Evidence: .omo/evidence/task-8b-event-no-result.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): command and event bundle emitters with method+params+result binding`
  - Files: `scripts/codegen/emit/command.ts`, `scripts/codegen/emit/event.ts`
  - Pre-commit: `bun run ts:check`

- [x] 9. Codegen $ref resolver + cycle detector → Shared.ts extraction

  **What to do**:
  - `scripts/codegen/resolveRefs.ts`: pure fn `resolveRefs(protocol: Protocol): { byDomain: Map<DomainName, ResolvedDomain>, sharedExtracted: TypeDef[] }`
  - Builds dependency graph; detects strongly-connected components across files (Tarjan); if a cycle crosses domain boundary → mark types for Shared.ts extraction
  - Within-file cycles: leave in place, T10 wraps with `Schema.suspend`
  - Cross-file refs that are NOT cyclic: emit `import` statement
  - Stable output: sort cycles by name

  **Must NOT do**:
  - No I/O
  - No premature optimization — SCC on full graph fine for ~50 domains
  - No silent extraction — `resolveRefs` returns a `diagnostics: { extracted: TypeDef[]; reason: string }[]` field; `scripts/codegen.ts` (T16) is the only caller that performs the actual stderr logging. `resolveRefs` itself remains pure.

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: graph algorithm + cycle rule decisions
  - **Skills**: [`effect-ts`] — Reason: ensure output is Schema-compatible

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T15, T16
  - **Blocked By**: T5, T6

  **References**:
  - Pattern: Tarjan's SCC algorithm — reference impl from any standard graph lib (do NOT take dep, vendor in scripts/codegen/scc.ts if needed)
  - Repo: `.omo/drafts/effect-cdp.md` — cross-file circular rule

  **Acceptance Criteria**:
  - [ ] Cross-file cycle in fixture-recursive correctly extracted to Shared
  - [ ] Non-cyclic cross-file ref correctly emits `import` (no extraction)
  - [ ] Output stable across runs (snapshot test in T15)

  **QA Scenarios**:

  ```
  Scenario: Cross-file cycle extracted
    Tool: Bash + bun -e
    Steps:
      1. Load `tests/codegen/fixtures/crossDomain.json`
      2. `bun -e "...resolveRefs(p); console.log([...res.sharedExtracted.map(t=>t.id)].sort().join(','))" | grep -E 'A\.X.*B\.Y'`
    Expected Result: both cyclic types in shared list
    Evidence: .omo/evidence/task-9-cycle-extracted.txt

  Scenario: Non-cyclic cross-file ref kept as import
    Tool: Bash + bun -e
    Steps:
      1. Load fixture where domain B references A but A does not reference B
      2. Verify `sharedExtracted` is empty, `byDomain.get('B').imports` includes 'A'
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-9-import-kept.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): $ref resolver with cycle-driven Shared.ts extraction`
  - Files: `scripts/codegen/resolveRefs.ts`, `scripts/codegen/scc.ts`
  - Pre-commit: `bun run ts:check`

- [x] 10. Codegen recursive type detector + `Schema.suspend` wrapping

  **What to do**:
  - `scripts/codegen/detectRecursive.ts`: pure fn that scans within-domain references; flags any self-referential or mutually-recursive group
  - `scripts/codegen/emit/suspend.ts`: wraps flagged types in `const X: Schema.Schema<XType> = Schema.suspend(() => ...)` with explicit type annotation (G3: no `as any`)
  - Must work for known CDP recursive types (Runtime.RemoteObject self-ref, DOM.Node children, Page.FrameTree)
  - Generate the type alias `XType` before the schema const so forward reference compiles

  **Must NOT do**:
  - No `as any` (G3) — use explicit `Schema.Schema<T>` annotation
  - No `Schema.suspend` for non-recursive types (perf cost)
  - No `let` in emitted code (const + suspend only)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: type-system gymnastics + Schema knowledge
  - **Skills**: [`effect-ts`] — Reason: Schema.suspend nuances

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T15, T16
  - **Blocked By**: T5

  **References**:
  - Pattern: `.repos/effect/packages/effect/test/schema/Schema.test.ts` — canonical Schema tests (search for `suspend`)
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/DOM/#type-Node` — DOM.Node.children recursive ref

  **Acceptance Criteria**:
  - [ ] DOM.Node generated as `Schema.suspend(() => ...)` w/ explicit `Schema.Schema<DOMNode>`
  - [ ] Non-recursive types NOT wrapped in suspend
  - [ ] `bun run ts:check` zero errors on generated DOM.ts

  **QA Scenarios**:

  ```
  Scenario: Recursive type wrapped, non-recursive not wrapped
    Tool: Bash + bun -e
    Steps:
      1. Run detector on fixture-recursive → returns set containing 'Tree' (recursive) but NOT 'Leaf' (non-recursive)
      2. `bun -e "import {emitSuspend} from './scripts/codegen/emit/suspend.ts'; console.log(emitSuspend('Tree', {...}))" | grep -E 'Schema\.suspend.*Schema\.Schema<Tree>'`
    Expected Result: suspend wrap + explicit type
    Evidence: .omo/evidence/task-10-suspend-correct.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): recursive type detector with Schema.suspend wrap`
  - Files: `scripts/codegen/detectRecursive.ts`, `scripts/codegen/emit/suspend.ts`
  - Pre-commit: `bun run ts:check`

- [x] 11. Codegen JSDoc emitter (@deprecated/@experimental only)

  **What to do**:
  - `scripts/codegen/emit/jsdoc.ts`: pure fn `emitJSDoc(item: { description?: string; deprecated?: boolean; experimental?: boolean })`
  - Only emit JSDoc when `deprecated` or `experimental` is true; description prepended only when one of those flags is set
  - Format: `/** @deprecated <description> */` or `/** @experimental <description> */` or both
  - No `@example`, no `@param`, no `@returns` (G21)

  **Must NOT do**:
  - No JSDoc on plain types (G21 — keep generated files lean)
  - No `@example` blocks
  - No multi-line prose descriptions (one line max)

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: small pure formatter
  - **Skills**: [`effect-ts`] — Reason: ensure JSDoc placement doesn't break Schema decoder inference

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T15, T16
  - **Blocked By**: T5

  **References**:
  - External: TSDoc spec for `@deprecated`, `@experimental`

  **Acceptance Criteria**:
  - [ ] Plain type → empty string output
  - [ ] Deprecated type → `/** @deprecated <desc> */`
  - [ ] Experimental type → `/** @experimental <desc> */`
  - [ ] Both → `/** @deprecated @experimental <desc> */` (single block)
  - [ ] No `@example` in any output: `grep -c '@example' scripts/codegen/emit/jsdoc.ts` → 0

  **QA Scenarios**:

  ```
  Scenario: Plain item emits nothing
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitJSDoc} from './scripts/codegen/emit/jsdoc.ts'; const s = emitJSDoc({description:'foo'}); if (s.length > 0) process.exit(1); console.log('OK')" | grep -q OK`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-11-jsdoc-empty.txt

  Scenario: Deprecated+experimental combined
    Tool: Bash + bun -e
    Steps:
      1. `bun -e "import {emitJSDoc} from './scripts/codegen/emit/jsdoc.ts'; console.log(emitJSDoc({deprecated:true,experimental:true,description:'gone soon'}))" | grep -E '@deprecated.*@experimental.*gone soon'`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-11-jsdoc-both.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): JSDoc emitter for deprecated/experimental annotations`
  - Files: `scripts/codegen/emit/jsdoc.ts`
  - Pre-commit: `bun run ts:check`

- [x] 12. Socket bridge (Queue.unbounded + Socket.run + Stream.fromQueue)

  **What to do**:
  - `src/internal/socketBridge.ts`: `makeSocketBridge: Effect.fnUntraced(function* (socket: Socket.Socket) { const queue = yield* Queue.unbounded<string | Uint8Array>(); yield* Effect.forkScoped(socket.run((chunk) => Queue.offerUnsafe(queue, chunk))); return { stream: Stream.fromQueue(queue), close: Queue.shutdown(queue) }; })`
  - Streaming TextDecoder per-connection (NOT global): `new TextDecoder('utf-8', { fatal: false })` with `decode(chunk, { stream: true })`
  - Decode happens in next stage (T18), bridge keeps raw chunks
  - Scope-bound: when scope closes, queue shuts down → stream terminates → dispatcher loop exits cleanly

  **Must NOT do**:
  - No `Socket.toChannel` (rejected in draft — extra layer)
  - No global TextDecoder (multi-byte char corruption across chunks)
  - No silent error swallow in `socket.run` handler
  - No `Effect.fn` (no span needed) — use `fnUntraced` (G15)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: Socket+Queue+Stream wiring + scope ordering
  - **Skills**: [`effect-ts`, `reliability-patterns`] — Reason: scoped fiber + clean shutdown discipline

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T18, T21
  - **Blocked By**: T2, T3

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/unstable/socket/Socket.ts` — Socket.run signature
  - Pattern: `.repos/effect/packages/effect/src/Queue.ts` — `unbounded`, `unsafeOffer`, `shutdown`
  - Pattern: `.repos/effect/packages/effect/src/Stream.ts` — `fromQueue`
  - Repo: `.omo/notes/effect-v4-cheatsheet.md` — Socket.run sync-callback contract (verified via T7)

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Stream emits chunks in order against echo server (synthetic test using `Effect.gen` with in-memory socket pair)
  - [ ] Scope close → stream terminates within 100ms (no zombie fiber)
  - [ ] `grep -n 'Socket.toChannel' src/` → exit 1 (forbidden)

  **QA Scenarios**:

  ```
  Scenario: Echo through bridge preserves order
    Tool: Bash + bun -e
    Preconditions: src/internal/socketBridge.ts exists
    Steps:
      1. `bun scripts/test-helpers/socket-echo.ts` (helper spawns in-mem socket pair, sends 'a','b','c', collects from stream)
      2. Assert output is ['a','b','c'] in order
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-12-echo-order.txt

  Scenario: Scope close terminates stream
    Tool: Bash + bun -e
    Steps:
      1. Open bridge, fork stream consumer, close scope after 50ms
      2. Assert consumer fiber exited within 100ms with no errors
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-12-scope-close.txt
  ```

  **Commit**: YES
  - Message: `feat(socket): scoped Queue-based inbound bridge with streaming TextDecoder`
  - Files: `src/internal/socketBridge.ts`, `scripts/test-helpers/socket-echo.ts`
  - Pre-commit: `bun run ts:check`

- [x] 13. PubSub events bus + dropped-event Metric + rate-limited warn

  **What to do**:
  - `src/internal/eventBus.ts`: `class EventBus extends Effect.Service<EventBus>()('EventBus', { effect: ... })`
  - On init: yield `eventBufferSize` from `CdpConfig`, create `PubSub.dropping<RawCdpEvent>(eventBufferSize)`, create `Metric.counter('cdp_events_dropped_total')`
  - `publish(event)`: `const accepted = PubSub.publishUnsafe(pubsub, event); if (!accepted) { yield* Metric.increment(droppedCounter); yield* warnDrop }`
  - `warnDrop`: rate-limited to once per 5s via `Schedule.spaced('5 seconds')` + `Effect.logWarning`
  - `subscribe()`: returns `Stream<RawCdpEvent>` via `PubSub.subscribe`
  - Service exposes `publish`, `subscribe`, `metrics` accessors
  - `RawCdpEvent` schema: `{ method: Schema.String, params: Schema.Json, sessionId: Schema.optional(SessionId) }`

  **Must NOT do**:
  - No `PubSub.bounded` (G8)
  - No per-method/per-domain counter split (G26)
  - No `console.warn` (G6) — use `Effect.logWarning`
  - No `Schema.Unknown` for params (G1) — `Schema.Json`
  - No `Effect.orDie` (G2)
  - No `Effect.fn` (no span needed) — `fnUntraced` (G15)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: PubSub semantics + Metric wiring + rate-limit pattern
  - **Skills**: [`effect-ts`, `observability`] — Reason: Metric.counter + structured logWarning + AGENTS.md logging rule (domain-level only)

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T18, T20, T33
  - **Blocked By**: T2, T3

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/PubSub.ts` — `dropping` strategy + `offer` return type
  - Pattern: `.repos/effect/packages/effect/src/Metric.ts` — `counter`, `increment`
  - Pattern: `.repos/effect/packages/effect/src/Schedule.ts` — rate-limit via `spaced`
  - Repo: AGENTS.md — logging only for domain events

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] `grep -E 'PubSub\.bounded|console\.' src/internal/eventBus.ts` → exit 1
  - [ ] Burst test: 1000 events with subscriber paused → drop counter ≥ (1000 - eventBufferSize)
  - [ ] Warn rate-limited: 1000 drops within 1s → ≤1 logWarning call

  **QA Scenarios**:

  ```
  Scenario: Backpressure drops + metric increments
    Tool: Bash + bun -e
    Steps:
      1. Start EventBus with eventBufferSize=16, no subscriber attached
      2. Publish 100 events
      3. Read metric `cdp_events_dropped_total` → value ≥ 84
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-13-backpressure-metric.txt

  Scenario: Warn rate-limited (≤1 per 5s)
    Tool: Bash + bun -e
    Steps:
      1. Capture stderr to file during 1000-drop burst
      2. `grep -c 'events dropped' /tmp/stderr` ≤ 1
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-13-warn-ratelimit.txt
  ```

  **Commit**: YES
  - Message: `feat(events): PubSub.dropping bus with cdp_events_dropped_total metric + rate-limited warn`
  - Files: `src/internal/eventBus.ts`
  - Pre-commit: `bun run ts:check`

- [x] 14. PendingMap (Ref<HashMap>) + atomic drain primitive + closed-flag

  **What to do**:
  - `src/internal/pending.ts`: `class PendingMap extends Effect.Service<PendingMap>()('PendingMap', { ... })`
  - State: `Ref<HashMap<CdpRequestId, { deferred: Deferred<unknown, CdpProtocolError | CdpDecodeError>, sessionId: Option<SessionId>, method: string }>>` + `Ref<boolean>` closed flag
  - `register(id, sessionId, method)`: if closed → fail `CdpDisconnected({ reason: 'ScopeFinalized' })`; else create Deferred + Ref.update (HashMap.set)
  - `complete(id, result)`: Ref.modify → HashMap.modifyAt removes + returns deferred → Deferred.succeed(result)
  - `fail(id, error)`: same but Deferred.fail
  - `drainAll(reason)`: `Ref.getAndSet(closedFlag, true)` then `Ref.getAndSet(pendingRef, HashMap.empty())` → for each, `Deferred.fail(CdpDisconnected({reason}))`
  - `drainSession(sessionId, reason)`: partition by sessionId, fail matching only (for `detachedFromTarget`)
  - `nextId()`: `Ref<number>` monotonic counter → `Brand.unsafe(CdpRequestId)(n)`

  **Must NOT do**:
  - No `bigint` (G9)
  - No `Schema.Unknown` (G1)
  - No `as` cast for ID — use `CdpRequestId.makeUnsafe` (T2)
  - No `Effect.orDie` (G2)
  - No global state — service per connection

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: atomic concurrency primitives + finalizer ordering correctness
  - **Skills**: [`effect-ts`, `transactions-and-consistency`] — Reason: atomic Ref.modify pattern + drain-vs-register race

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T18, T19, T20, T21, T32
  - **Blocked By**: T2, T3

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Ref.ts` — `modify`, `getAndSet`
  - Pattern: `.repos/effect/packages/effect/src/HashMap.ts` — `set`, `modifyAt`, `partition`
  - Pattern: `.repos/effect/packages/effect/src/Deferred.ts` — `make`, `succeed`, `fail`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Register after close fails immediately with CdpDisconnected
  - [ ] drainAll empties map AND fails all deferreds atomically (no race window)
  - [ ] drainSession only affects matching sessionId entries

  **QA Scenarios**:

  ```
  Scenario: drainAll atomic
    Tool: Bash + bun -e
    Steps:
      1. Register 100 deferreds concurrently with 1 drainAll fired mid-stream
      2. Assert: every Deferred either succeeded OR failed with CdpDisconnected; no leaks (final map empty)
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-14-drain-atomic.txt

  Scenario: drainSession filters
    Tool: Bash + bun -e
    Steps:
      1. Register 5 with sessionId='A', 5 with 'B'
      2. drainSession('A', 'TargetDetached')
      3. Assert 5 A-deferreds failed, 5 B-deferreds still pending
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-14-drain-session.txt

  Scenario: register after close → CdpDisconnected
    Tool: Bash + bun -e
    Steps:
      1. close()
      2. register() → expect Effect failure with CdpDisconnected._tag
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-14-closed-rejects.txt
  ```

  **Commit**: YES
  - Message: `feat(dispatcher): PendingMap with atomic drain and closed-flag guard`
  - Files: `src/internal/pending.ts`
  - Pre-commit: `bun run ts:check`

- [x] 15. Codegen unit tests (tests/codegen/) targeting ≥80% coverage

  **What to do**:
  - `tests/codegen/schema.test.ts`: emitter unit tests with 5+ fixtures (primitive, struct, optional, array, enum, JsonValue fallback)
  - `tests/codegen/refResolver.test.ts`: cycle detection cases (no cycle, self-cycle, cross-file cycle, 3-node cycle)
  - `tests/codegen/recursive.test.ts`: recursive detector + suspend wrap
  - `tests/codegen/jsdoc.test.ts`: 4 JSDoc cases (none, deprecated, experimental, both)
  - `tests/codegen/integration.test.ts`: full pipeline against fixtures, snapshot test
  - Run with `bun test --coverage scripts/codegen/`; target ≥80% lines

  **Must NOT do**:
  - No real CDP JSON (use fixtures — stable)
  - No I/O beyond reading fixture files
  - No Effect runtime spin-up (codegen is sync)
  - No mocking — pure functions take inputs return outputs

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: thorough test design covering edge cases
  - **Skills**: [`testing-strategy`, `tdd`] — Reason: behavior tests, snapshot discipline, coverage interpretation

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 2
  - **Blocks**: T16 (need green tests before running real codegen)
  - **Blocked By**: T8, T9, T10, T11

  **References**:
  - External: `https://bun.sh/docs/test/coverage` — bun test coverage report format
  - Repo: AGENTS.md — 80% coverage rule for non-autogenerated

  **Acceptance Criteria**:
  - [ ] `bun test tests/codegen/` exits 0
  - [ ] `bun test --coverage scripts/codegen/` reports ≥80% line coverage
  - [ ] Snapshot files committed under `tests/codegen/__snapshots__/`

  **QA Scenarios**:

  ```
  Scenario: All codegen tests pass + coverage ≥80%
    Tool: Bash
    Steps:
      1. `bun test --coverage tests/codegen/ 2>&1 | tee /tmp/cov.txt`
      2. `grep -E 'scripts/codegen.*8[0-9]\.|9[0-9]\.|100\.' /tmp/cov.txt` → exit 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-15-coverage.txt
  ```

  **Commit**: YES
  - Message: `test(codegen): unit tests with ≥80% coverage on emitter pipeline`
  - Files: `tests/codegen/*.test.ts`, `tests/codegen/__snapshots__/*`
  - Pre-commit: `bun test tests/codegen/`

- [x] 16. Run codegen → `src/generated/*.ts` + idempotency verification (AC3)

  **What to do**:
  - `scripts/codegen.ts` orchestrator: load protocol → resolve refs → detect recursive → emit per-domain → write `src/generated/<Domain>.ts` (one per domain, Schema domain → `CdpSchema.ts`)
  - Generate `src/generated/index.ts` barrel exporting namespaces (ONLY allowed barrel per G7)
  - Append/regenerate `src/generated/Shared.ts` (extracted cycles from T9 merged into T6's seed)
  - Sort everything deterministically (T5 sort.ts) so output is byte-stable
  - Add file header: `// AUTO-GENERATED by scripts/codegen.ts — DO NOT EDIT`

  **Must NOT do**:
  - No filename `src/generated/Schema.ts` (G10) — use `CdpSchema.ts`
  - No `Schema.Unknown` in any generated file (G1, G17)
  - No `export default` (G19)
  - No hand-edits to generated files (header warns)
  - No emitting items beyond what AST contains (no creative additions)

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: orchestration of already-built pure functions
  - **Skills**: [`effect-ts`] — Reason: ensure output compiles + ts:check passes

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 3
  - **Blocks**: T17, T22, T24-T28
  - **Blocked By**: T8, T9, T10, T11, T15

  **References**:
  - Repo: `.omo/drafts/effect-cdp.md` — rename map { Schema: CdpSchema }

  **Acceptance Criteria**:
  - [ ] AC3: `bun run codegen && git diff --exit-code src/generated/` exits 0 (idempotent)
  - [ ] `bun run ts:check` zero errors on all generated files
  - [ ] `ls src/generated/` contains ~50 .ts files (one per CDP domain) + `index.ts`, `Shared.ts`, `CdpSchema.ts`
  - [ ] `grep -l 'Schema.Unknown' src/generated/` → empty (G17 enforced)
  - [ ] `grep -l 'export default' src/generated/` → empty (G19 enforced)
  - [ ] No file named `src/generated/Schema.ts` (G10)

  **QA Scenarios**:

  ```
  Scenario: Codegen idempotent (AC3)
    Tool: Bash
    Steps:
      1. `bun run codegen`
      2. `git add src/generated && git diff --cached --quiet src/generated` → exit 0
      3. `bun run codegen` again
      4. `git diff --exit-code src/generated/` → exit 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-16-idempotent.txt

  Scenario: All generated files typecheck
    Tool: Bash
    Steps:
      1. `bun run ts:check 2>&1 | tee /tmp/ts.txt`
      2. `grep -c error /tmp/ts.txt` → 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-16-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): emit src/generated/*.ts for all CDP domains`
  - Files: `scripts/codegen.ts`, `src/generated/**`
  - Pre-commit: `bun run codegen && bun run ts:check && git diff --exit-code src/generated/`

- [x] 17. check-codegen.ts: `satisfies ProtocolMapping` (AC6)

  **What to do**:
  - `scripts/check-codegen.ts`: for each generated command, emit a compile-time assertion: `type _ = (typeof <Schema>) extends Schema.Schema<ProtocolMapping.Commands['<method>']['paramsType']> ? true : never;`
  - Similar for returnType and events
  - When `bun run check-codegen` runs, TypeScript compile-checks all assertions; any mismatch → type error
  - Generated as part of codegen pipeline (T16 writes; T17 just adds the runner script)
  - Prototype the `satisfies` shape against 3 commands first (`Runtime.evaluate`, `DOM.querySelector`, `Page.navigate`) to confirm it actually narrows correctly — if not, fail loud and we revisit AC6

  **Must NOT do**:
  - No runtime decoding in this script (compile-time only)
  - No `as` casts to force types to match (G3) — if mismatch, that's a real bug
  - No suppression of TS errors

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: TypeScript inference + Schema type math
  - **Skills**: [`effect-ts`] — Reason: Schema.Schema<T> generic discipline

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 3
  - **Blocks**: F1, F2
  - **Blocked By**: T16

  **References**:
  - External: `https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#satisfies` — satisfies operator
  - External: `node_modules/devtools-protocol/types/protocol-mapping.d.ts` — ProtocolMapping type shape

  **Acceptance Criteria**:
  - [ ] AC6: `bun scripts/check-codegen.ts` exits 0 (compiles cleanly)
  - [ ] Prototype 3 commands verified before running across all
  - [ ] If any command mismatches → script prints `MISMATCH <method>` and exits 1

  **QA Scenarios**:

  ```
  Scenario: Satisfies passes for all commands
    Tool: Bash
    Steps:
      1. `bun scripts/check-codegen.ts 2>&1 | tee /tmp/cc.txt`
      2. `grep -c MISMATCH /tmp/cc.txt` → 0
      3. Exit code 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-17-satisfies.txt

  Scenario: Negative test — corrupt generated schema → check fails
    Tool: Bash
    Steps:
      1. Backup src/generated/Runtime.ts
      2. Sed-replace `Schema.String` → `Schema.Number` in one params field
      3. `bun scripts/check-codegen.ts` → exit 1, prints MISMATCH
      4. Restore backup
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-17-negative.txt
  ```

  **Commit**: YES
  - Message: `feat(codegen): check-codegen.ts asserts schemas satisfy ProtocolMapping`
  - Files: `scripts/check-codegen.ts`
  - Pre-commit: `bun scripts/check-codegen.ts`

- [x] 18. Inbound dispatcher loop (route by `method` presence, error wins)

  **What to do**:
  - `src/internal/dispatcher.ts`: `runDispatcher: Effect.fnUntraced(function* (bridge, eventBus, pending) { yield* Stream.runForEach(bridge.stream, processFrame) })`
  - `processFrame`: TextDecode chunk (streaming mode) → try `JSON.parse` → on failure log debug + emit `CdpDecodeError` to logWarning (rate-limited), continue (don't crash inbound)
  - Route by `method` field presence (NOT `id` presence):
    - HAS `method` + NO `id` → event → `eventBus.publish({ method, params, sessionId })`
    - HAS `id` + (HAS `error` OR HAS `result`) → response → `pending.complete/fail(id, ...)`. If BOTH `error` and `result` present: error wins (G… rule)
    - HAS both `id` and `method` (non-standard) → treat as event, log info once
    - Special case: `Target.detachedFromTarget` event → `pending.drainSession(sessionId, 'TargetDetached')` THEN publish event
  - On stream end (socket closed) → `pending.drainAll('SocketClosed')` then exit fiber cleanly
  - On stream error → `pending.drainAll('SocketClosed')` then rethrow as `CdpDisconnected({ reason: 'SocketClosed' })`

  **Must NOT do**:
  - No routing by `id` presence (events with `id` would misroute)
  - No swallowing CdpDecodeError silently (must increment metric or log)
  - No `console.*` (G6)
  - No `Effect.orDie` (G2)
  - No `as` casts when narrowing JSON parse output (use Schema decode or type guards)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: routing correctness + concurrency races + edge cases
  - **Skills**: [`effect-ts`, `error-handling`] — Reason: typed error discipline + stream lifecycle

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 3
  - **Blocks**: T22
  - **Blocked By**: T12, T13, T14

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Target/#event-detachedFromTarget` — sessionId semantics
  - Pattern: `.repos/effect/packages/effect/src/Stream.ts` — `runForEach`, `runDrain`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Event with both `id` + `method` routes as event + emits info log
  - [ ] Response with both `error` + `result` → deferred fails (error wins)
  - [ ] Malformed JSON → logWarning (rate-limited), dispatcher continues
  - [ ] `Target.detachedFromTarget` drains matching session pending BEFORE publishing event

  **QA Scenarios**:

  ```
  Scenario: Event-with-id routes as event
    Tool: Bash + bun -e (synthetic dispatcher harness)
    Steps:
      1. Inject frame `{"id":1,"method":"Runtime.consoleAPICalled","params":{}}`
      2. Assert eventBus.publish called once, pending unaffected
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-18-event-with-id.txt

  Scenario: Both error+result → error wins
    Tool: Bash + bun -e
    Steps:
      1. Register pending id=42
      2. Inject `{"id":42,"result":{"ok":1},"error":{"code":-1,"message":"x"}}`
      3. Assert deferred failed with CdpProtocolError, not succeeded
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-18-error-wins.txt

  Scenario: Malformed JSON does not crash dispatcher
    Tool: Bash + bun -e
    Steps:
      1. Send malformed frame `{not json`
      2. Send valid frame immediately after → should still process
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-18-malformed-continues.txt
  ```

  **Commit**: YES
  - Message: `feat(dispatcher): inbound loop routes by method presence, error precedence on responses`
  - Files: `src/internal/dispatcher.ts`
  - Pre-commit: `bun run ts:check`

- [x] 19. Outbound send() (id assign + omit absent + timeout cleanup)

  **What to do**:
  - `src/internal/send.ts`: `send(method: string, params: unknown, opts: { sessionId?: SessionId; timeout?: Duration })`
  - Get next id via `pending.nextId()`, register pending entry
  - Build wire frame: `const frame: Record<string, unknown> = { id, method }; if (params !== undefined) frame.params = params; if (opts.sessionId) frame.sessionId = opts.sessionId;` — absent keys omitted, NEVER serialize `null`/`undefined`
  - `Socket.write(JSON.stringify(frame))`; on write failure → `pending.fail(id, CdpDisconnected({reason:'SocketClosed'}))`, rethrow as typed error
  - Wrap `Deferred.await` with `Effect.timeoutFail({ duration: opts.timeout ?? Duration.infinity, onTimeout: () => new CdpTimeout({method, requestId: id, durationMs}) })`
  - On timeout: ALSO clean up pending entry (`pending.fail(id, CdpTimeout(...))`) so map doesn't leak
  - Default timeout: NONE (caller opt-in only — per draft decision)

  **Must NOT do**:
  - No global default timeout
  - No `null` serialized for missing params (must omit key)
  - No `as` casts on frame builder
  - No `bigint` (G9)
  - No `Effect.orDie` (G2)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: race-condition discipline + wire format correctness
  - **Skills**: [`effect-ts`, `reliability-patterns`] — Reason: timeout cleanup pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 3
  - **Blocks**: T22, T32
  - **Blocked By**: T14

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Effect.ts` — `timeoutFail`
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/#general-considerations` — wire format

  **Acceptance Criteria**:
  - [ ] Frame omits `params` when undefined: assert `JSON.stringify(...)` does not contain `"params"`
  - [ ] Frame omits `sessionId` when not provided
  - [ ] Timeout fires → CdpTimeout AND pending map shrinks
  - [ ] No global default timeout: `send('X', undefined, {})` waits forever (unit test with `TestClock.adjust(years)`)

  **QA Scenarios**:

  ```
  Scenario: Omit absent params
    Tool: Bash + bun -e
    Steps:
      1. Mock socket capturing writes
      2. send('Page.enable', undefined, {})
      3. Assert captured frame === `{"id":1,"method":"Page.enable"}` (no params key)
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-19-omit-params.txt

  Scenario: Timeout fires and cleans up
    Tool: Bash + bun -e (TestClock)
    Steps:
      1. send with timeout=100ms; never respond on socket
      2. TestClock.adjust(200ms)
      3. Assert: failure is CdpTimeout, pending.size === 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-19-timeout-cleanup.txt
  ```

  **Commit**: YES
  - Message: `feat(dispatcher): outbound send with id allocation, key omission, and timeout cleanup`
  - Files: `src/internal/send.ts`
  - Pre-commit: `bun run ts:check`

- [x] 20. SessionRegistry (idempotent attach/detach)

  **What to do**:
  - `src/SessionRegistry.ts`: `class SessionRegistry extends Effect.Service<SessionRegistry>()('SessionRegistry', { ... })`
  - State: `Ref<HashMap<SessionId, { targetId: TargetId; targetInfo: TargetInfo; parentSessionId: Option<SessionId> }>>`
  - Subscribe to `EventBus` stream filtered by `method === 'Target.attachedToTarget' | 'Target.detachedFromTarget'`
  - `Target.attachedToTarget`: upsert (idempotent — if exists, replace; no-op if identical)
  - `Target.detachedFromTarget`: call `pending.drainSession(sessionId, 'TargetDetached')` THEN remove from registry. Tolerate detach-before-attach race — remove is a no-op if not present
  - Expose: `getAll: Stream<SessionId[]>`, `get(sessionId): Option<SessionInfo>`, `subscribeChanges: Stream<{ added: SessionId[]; removed: SessionId[] }>`
  - Forked subscriber scoped to service lifecycle

  **Must NOT do**:
  - No exception on detach-before-attach (race tolerated)
  - No exception on attach-of-existing (idempotent)
  - No `Schema.Unknown` for targetInfo
  - No `console.*`
  - No `Effect.orDie`

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: race tolerance + subscription lifecycle
  - **Skills**: [`effect-ts`] — Reason: forked scoped subscriber pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 3
  - **Blocks**: T22, T28, T31, T34
  - **Blocked By**: T13, T14

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Target/#event-attachedToTarget` — sessionId + targetInfo shape

  **Acceptance Criteria**:
  - [ ] Attach → Attach (same sessionId, same targetInfo) is no-op (HashMap.set idempotent)
  - [ ] Attach → Attach (same sessionId, different targetInfo) replaces
  - [ ] Detach without prior attach → no error
  - [ ] Detach → drainSession called BEFORE registry remove (assert call order)

  **QA Scenarios**:

  ```
  Scenario: Detach drains then removes
    Tool: Bash + bun -e
    Steps:
      1. Spy on pending.drainSession
      2. Publish attachedToTarget(sessionId='A'), then detachedFromTarget('A')
      3. Assert call sequence: drainSession('A','TargetDetached') THEN registry.get('A') === None
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-20-detach-order.txt

  Scenario: Detach-before-attach tolerated
    Tool: Bash + bun -e
    Steps:
      1. Publish detachedFromTarget('Ghost') without prior attach
      2. Assert no error, registry.get('Ghost') === None
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-20-orphan-detach.txt
  ```

  **Commit**: YES
  - Message: `feat(service): SessionRegistry with idempotent attach and ordered detach drain`
  - Files: `src/SessionRegistry.ts`
  - Pre-commit: `bun run ts:check`

- [x] 21. Scope finalizer ordering (drain pending FIRST, close socket LAST)

  **What to do**:
  - `src/CdpConnection.ts`: `class CdpConnection extends Effect.Service<CdpConnection>()('CdpConnection', { effect: ... })`
  - In service constructor (inside `Effect.gen`):
    1. Create Socket (via `@effect/platform-{node|bun}` socket layer)
    2. Create bridge (T12), eventBus (T13), pending (T14), registry (T20)
    3. **Register finalizers in REVERSE intended order** because Scope is LIFO:
       - `Effect.addFinalizer(() => Socket.close)` FIRST (runs LAST)
       - `Effect.addFinalizer(() => pending.drainAll('ScopeFinalized'))` SECOND (runs FIRST)
    4. Fork dispatcher loop scoped to connection
  - Result: on scope close → drain pending → close socket → dispatcher loop ends naturally
  - Document the LIFO trick at top of file with comment block

  **Must NOT do**:
  - No socket close BEFORE pending drain (would lose typed errors)
  - No `Effect.orDie` (G2)
  - No `Layer.orDie` on this intermediate Layer (G16) — only on final live composition

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: LIFO finalizer ordering is the single most subtle correctness issue
  - **Skills**: [`effect-ts`, `reliability-patterns`] — Reason: scope discipline + clean shutdown

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 3
  - **Blocks**: T22
  - **Blocked By**: T12, T14

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Scope.ts` — finalizer LIFO contract
  - Pattern: `.repos/effect/packages/effect/src/Effect.ts` — `addFinalizer`
  - Repo: `.omo/notes/effect-v4-cheatsheet.md` (T7) — LIFO note

  **Acceptance Criteria**:
  - [ ] On scope close: pending deferreds fail with CdpDisconnected({reason:'ScopeFinalized'}) BEFORE socket reports closed
  - [ ] Comment block at file top documents LIFO rule explicitly
  - [ ] `bun run ts:check` zero errors
  - [ ] CdpConnection Layer typed `Layer.Layer<CdpConnection>` (no orDie on intermediate, G16)

  **QA Scenarios**:

  ```
  Scenario: Finalizer order observable
    Tool: Bash + bun -e
    Steps:
      1. Instrument: log timestamp when pending.drainAll fires, log timestamp when socket.close fires
      2. Open and close scope
      3. Assert drainAll timestamp < socket.close timestamp
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-21-finalizer-order.txt

  Scenario: Pending fails with ScopeFinalized reason
    Tool: Bash + bun -e
    Steps:
      1. Start connection, register a deferred via send() that never gets response
      2. Close scope
      3. Assert deferred failed with CdpDisconnected({reason:'ScopeFinalized'})
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-21-reason-correct.txt
  ```

  **Commit**: YES
  - Message: `feat(dispatcher): CdpConnection with LIFO finalizers (drain pending before socket close)`
  - Files: `src/CdpConnection.ts`
  - Pre-commit: `bun run ts:check`

- [x] 22. Cdp service Layer composition

  **What to do**:
  - **Typed send API per G34**: `Cdp.send(cmd, params, opts)` consumes a Command bundle from `src/generated/<Domain>.ts` (emitted by T8b). Result type inferred from `cmd.result`. Encoder uses `cmd.params`. Low-level escape hatch (raw method string) NOT exposed publicly.
  - `src/Cdp.ts`: `class Cdp extends Effect.Service<Cdp>()('Cdp', { effect: ... , dependencies: [CdpConnection.Default, EventBus.Default, PendingMap.Default, SessionRegistry.Default] })`
  - Inside `effect`: yield all 4 deps; expose `send(method, params, opts)`, `events: Stream<RawCdpEvent>`, `registry: SessionRegistry`, `discovery: HttpDiscovery`
  - Final live layer typed `Layer.Layer<Cdp>` (G16 applies here — may use `Layer.orDie` ONLY here since this is the user-facing composition)
  - `Cdp.layer(config: CdpConfig)`: factory returning fully-wired Layer
  - `Cdp.layerNode(config)` / `Cdp.layerBun(config)`: convenience wrappers that include platform Socket layer

  **Must NOT do**:
  - No intermediate `Layer.orDie` (G16) — only the final user-facing layer if needed
  - No service passed as fn arg (G13) — yield from context
  - No `Schema.Unknown`
  - No re-exporting individual internals via barrels (G7)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: final composition ergonomics + Layer typing discipline
  - **Skills**: [`effect-ts`] — Reason: Effect.Service with dependencies pattern (Effect v4)

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T23, T29, T30, T31, T34
  - **Blocked By**: T18, T19, T20, T21

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Layer.ts` — composition
  - Pattern: `.repos/effect/packages/platform-node/src/NodeSocket.ts` — platform socket layer
  - Pattern: `.repos/effect/packages/platform-bun/src/BunSocket.ts` — platform socket layer

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Importing `import { Cdp } from 'effect-cdp'` exposes only `Cdp` namespace + helpers
  - [ ] `Cdp.layerNode(config)` returns `Layer.Layer<Cdp, never, never>` (no missing deps)
  - [ ] No internal services leaked to public API (`src/index.ts` exports only Cdp, helpers, errors, types)

  **QA Scenarios**:

  ```
  Scenario: Public API surface
    Tool: Bash
    Steps:
      1. `bunx tsc --emitDeclarationOnly --outDir /tmp/dts`
      2. `cat /tmp/dts/index.d.ts` → contains: Cdp, errors, types, helpers
      3. Does NOT contain: PendingMap, EventBus, CdpConnection, internal/*
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-22-public-api.txt
  ```

  **Commit**: YES
  - Message: `feat(service): Cdp top-level service with platform-specific layer factories`
  - Files: `src/Cdp.ts`, `src/index.ts` (public exports)
  - Pre-commit: `bun run ts:check`

- [x] 23. Session lens (`Cdp.session(id).send` / `.events`)

  **What to do**:
  - `src/Cdp.ts` extension: `Cdp.session(sessionId: SessionId)` returns `{ send: (method, params, opts) => Effect<...>, events: Stream<RawCdpEvent> }`
  - `send` injects `sessionId` into outbound frame (omitted when undefined per T19 rule)
  - `events` filters main eventBus stream by `event.sessionId === sessionId`
  - Pure pre-binding — no IO until session methods are called
  - Root browser session: `Cdp.session(undefined)` or distinct `Cdp.root` accessor — omits sessionId from frame

  **Must NOT do**:
  - No new service per session (G13 wording — services from context, but here lens is fine)
  - No mutation of underlying Cdp state
  - No `as` casts on event filter

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: ergonomic API design with type narrowing
  - **Skills**: [`effect-ts`, `vercel-composition-patterns`] — Reason: lens/composable API patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T24-T28, T31, T34
  - **Blocked By**: T22

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Stream.ts` — `filter`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] `Cdp.session(sid).send(...)` injects sessionId; root send omits
  - [ ] `Cdp.session(sid).events` only emits matching sessionId events (verified in T34)

  **QA Scenarios**:

  ```
  Scenario: Session lens isolates events
    Tool: Bash + bun -e
    Steps:
      1. Mock eventBus emits events sessionId=A and sessionId=B
      2. Collect Cdp.session('A').events for 100ms
      3. Assert all collected events have sessionId === 'A'
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-23-lens-isolates.txt
  ```

  **Commit**: YES
  - Message: `feat(service): Cdp.session(id) lens for session-scoped send and events`
  - Files: `src/Cdp.ts`
  - Pre-commit: `bun run ts:check`

- [x] 24. Helper: `Page.goto + waitForLoad`

  **What to do**:
  - `src/helpers/Page.ts`: `goto(url: string, opts?: { waitUntil?: 'load' | 'domcontentloaded' })`
  - Effect: enable Page domain → send `Page.navigate({url})` → await `Page.loadEventFired` (or `Page.domContentEventFired`) on this session's events stream
  - Decode `Page.navigate` response → if `errorText` non-empty → fail with `CdpProtocolError({code:-1, message: errorText, method:'Page.navigate'})`
  - Compose via `Cdp.session(id)`; helper takes sessionId arg explicitly (no global)
  - Default `waitUntil: 'load'`

  **Must NOT do**:
  - No additional waitFor variants (G22 — only what's stated)
  - No screenshot, no PDF, no metrics calls (G11)
  - No NavigationTimeout option — caller composes with `Effect.timeoutFail(CdpTimeout(...))`
  - No `Schema.Unknown` on errorText

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: integrates session lens, events, response decode
  - **Skills**: [`effect-ts`] — Reason: stream filtering + decode pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T29
  - **Blocked By**: T16, T23

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-navigate`, `#event-loadEventFired`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Calling `goto` on detached session → `CdpDisconnected({reason:'TargetDetached'})`
  - [ ] Calling `goto` to invalid URL with errorText → `CdpProtocolError`

  **QA Scenarios**:

  ```
  Scenario: goto returns after load event (against real Chromium)
    Tool: Bash + Real Chromium (assumes `chromium --remote-debugging-port=9222 --headless` running)
    Preconditions: T22 (Cdp service) + T16 (generated/Page.ts) + T23 (session lens) built
    Steps:
      1. `bun -e "import {Effect,Schema,Layer,Duration} from 'effect'; import {Cdp} from './src/Cdp.ts'; import {goto} from './src/helpers/Page.ts'; import {attach} from './src/helpers/Target.ts'; const prog = Effect.gen(function*(){ const cdp = yield* Cdp; const list = yield* cdp.discovery.list(); const sid = yield* attach(list[0].id); const r = yield* goto(sid, 'data:text/html,<title>X</title><body>ok</body>', {waitUntil:'load'}); console.log('OK goto', r ? 'completed' : 'noop'); }); await Effect.runPromise(prog.pipe(Effect.provide(Cdp.layerBun({webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/<wid>',eventBufferSize:256}))));" 2>&1 | tee /tmp/t24.txt`
      2. Assert exit 0
      3. `grep -q 'OK goto completed' /tmp/t24.txt`
    Expected Result: exit 0, line 'OK goto completed' present in stdout
    Failure Indicators: nonzero exit, missing OK line, hang > 10s
    Evidence: .omo/evidence/task-24-goto-load.txt

  Scenario: goto on invalid URL surfaces CdpProtocolError
    Tool: Bash + Real Chromium
    Preconditions: same as above
    Steps:
      1. Replace goto target with 'chrome-error://invalid-url' (forces errorText)
      2. Catch via `Effect.catchTag('CdpProtocolError', e => Effect.sync(() => { console.log('OK protocol-error', e.message); return 0; }))` and run
      3. `grep -q 'OK protocol-error' /tmp/t24-err.txt`
    Expected Result: exit 0, 'OK protocol-error' line present
    Evidence: .omo/evidence/task-24-goto-error.txt
  ```

  **Commit**: YES
  - Message: `feat(helpers): Page.goto with waitForLoad`
  - Files: `src/helpers/Page.ts`
  - Pre-commit: `bun run ts:check`

- [x] 25. Helper: `Network.waitForResponse(string | RegExp)`

  **What to do**:
  - `src/helpers/Network.ts`: `waitForResponse(sessionId: SessionId, urlPattern: string | RegExp, opts?: { timeout?: Duration })`
  - Enable Network domain (idempotent send `Network.enable`) — helper internally tracks via per-session Ref to avoid re-enable storms (or just always send — CDP allows)
  - Subscribe to session's `Network.responseReceived` events → first match where url matches pattern (string → equality, RegExp → test) → decode `Response` via Schema → return decoded
  - Apply `Effect.timeoutFail(CdpTimeout)` from opts.timeout (no default)
  - PASSIVE only (G11: no Fetch interception, no request modification)

  **Must NOT do**:
  - No glob support (G22 scope limit — only string equality or RegExp)
  - No `Fetch.enable` (G11)
  - No request modification
  - No retry

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: stream + decode + timeout composition
  - **Skills**: [`effect-ts`] — Reason: Stream.takeWhile + Schema decode pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T29
  - **Blocked By**: T16, T23

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-responseReceived`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] String pattern: exact URL match only
  - [ ] RegExp pattern: `.test(url)` match
  - [ ] Timeout fires → CdpTimeout (no event leak)

  **QA Scenarios** (T29 covers happy path; this task adds timeout test):

  ```
  Scenario: Timeout when no matching response
    Tool: Bash + Real Chromium via T29 infra
    Steps:
      1. Page.goto('about:blank')
      2. Network.waitForResponse('https://does-not-exist', {timeout:Duration.millis(500)})
      3. Assert: fails with CdpTimeout._tag
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-25-no-match-timeout.txt
  ```

  **Commit**: YES
  - Message: `feat(helpers): Network.waitForResponse (passive, string or RegExp)`
  - Files: `src/helpers/Network.ts`
  - Pre-commit: `bun run ts:check`

- [x] 26. Helper: `Runtime.evaluate` (caller-supplied Schema for typed unwrap)

  **What to do**:
  - `src/helpers/Runtime.ts`: `evaluate<A, I>(sessionId, expression: string, schema: Schema.Schema<A, I>, opts?: { returnByValue?: boolean })`
  - Default `returnByValue: true` (so we get JSON value back, not RemoteObject reference)
  - Send `Runtime.evaluate({expression, returnByValue: opts.returnByValue ?? true})`
  - On response: if `exceptionDetails` present → fail `CdpProtocolError({code:-32000, message: exceptionDetails.text, method:'Runtime.evaluate'})`
  - Else: take `result.value` (JsonValue) → `Schema.decodeUnknown(schema)` → on decode failure → fail `CdpDecodeError({raw: JSON.stringify(result.value), parseError: Cause.pretty(err)})`
  - Return the decoded `A`

  **Must NOT do**:
  - No `Schema.Unknown` fallback for caller
  - No implicit JSON.parse beyond Schema decode
  - No `RemoteObject` reference mode in v1 (G22 — stick to returnByValue=true)
  - No `as` casts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: Schema generic + decode error mapping
  - **Skills**: [`effect-ts`, `input-validation`] — Reason: Schema decode + typed error mapping

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T29
  - **Blocked By**: T16, T23

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] AC1 covered: `Runtime.evaluate(session, '1+1', Schema.Number)` returns `2`
  - [ ] Decode mismatch produces `CdpDecodeError` (not crash)
  - [ ] JavaScript exception in evaluated expression produces `CdpProtocolError`

  **QA Scenarios**:

  ```
  Scenario: Decode mismatch → CdpDecodeError
    Tool: Bash + Real Chromium (via T29 infra)
    Steps:
      1. Runtime.evaluate(session, '"hello"', Schema.Number)
      2. Assert: failure is CdpDecodeError
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-26-decode-mismatch.txt

  Scenario: JS exception → CdpProtocolError
    Tool: Bash + Real Chromium
    Steps:
      1. Runtime.evaluate(session, 'throw new Error("boom")', Schema.Json)
      2. Assert: failure is CdpProtocolError, message contains 'boom'
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-26-js-exception.txt
  ```

  **Commit**: YES
  - Message: `feat(helpers): Runtime.evaluate with caller Schema for typed unwrap`
  - Files: `src/helpers/Runtime.ts`
  - Pre-commit: `bun run ts:check`

- [x] 27. Helper: `DOM.querySelector + click`

  **What to do**:
  - `src/helpers/DOM.ts`: `querySelector(sessionId, nodeId: NodeId, selector: string) => Effect<NodeId, ...>`
  - Internally: enable DOM (idempotent) → `DOM.getDocument` (cache rootNodeId per session via Ref) → `DOM.querySelector({nodeId:root, selector})`
  - `click(sessionId, nodeId: NodeId) => Effect<void, ...>`: `DOM.getBoxModel` → compute centroid of `content` quad → `Input.dispatchMouseEvent({type:'mousePressed',...})` + `mouseReleased` w/ button: 'left'
  - Centroid computation: pure function in `src/helpers/internal/centroid.ts` (pure, easily unit-tested)
  - If selector matches nothing (returned nodeId === 0): `CdpProtocolError({code:-1, message:'No element matches selector: '+selector, method:'DOM.querySelector'})`

  **Must NOT do**:
  - No `DOM.waitForSelector` (G22)
  - No `DOM.screenshot` (G11)
  - No XPath helper
  - No jQuery-style chaining
  - No `Schema.Unknown`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: multi-step CDP composition
  - **Skills**: [`effect-ts`] — Reason: Ref caching pattern for root node

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T29, T36
  - **Blocked By**: T16, T23

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-querySelector`, `getBoxModel`, `Input.dispatchMouseEvent`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] querySelector no-match → CdpProtocolError
  - [ ] click invokes both mousePressed AND mouseReleased (assert via T29 events captured)
  - [ ] Centroid pure fn unit-tested in tests/codegen/ extension

  **QA Scenarios**:

  ```
  Scenario: Click submits a real form button (real chromium)
    Tool: Bash + Real Chromium (covered by T29)
    Steps:
      1. Page.goto data URL with `<button id=b onclick="document.title='clicked'">x</button>`
      2. nodeId = querySelector(root, '#b')
      3. click(nodeId)
      4. Runtime.evaluate('document.title', Schema.String) === 'clicked'
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-27-click-real.txt
  ```

  **Commit**: YES
  - Message: `feat(helpers): DOM.querySelector + click via Input.dispatchMouseEvent`
  - Files: `src/helpers/DOM.ts`, `src/helpers/internal/centroid.ts`
  - Pre-commit: `bun run ts:check`

- [x] 28. Helper: `Target.attach + auto-attach` (flat + recursive)

  **What to do**:
  - `src/helpers/Target.ts`:
    - `attach(targetId): Effect<SessionId, ...>` → `Target.attachToTarget({targetId, flatten:true})` → return `sessionId` from response
    - `autoAttach(opts?: { waitForDebuggerOnStart?: boolean })` → `Target.setAutoAttach({autoAttach:true, waitForDebuggerOnStart: opts.waitForDebuggerOnStart ?? false, flatten:true})` + recurse: register handler on `Target.attachedToTarget` that calls itself for each new child target (recursive auto-attach for nested OOPIFs/SW)
  - Both modes use `flatten:true` (G4 — NEVER `sendMessageToTarget`)
  - No filtering (G23) — attach to every reported target
  - SessionRegistry (T20) already tracks the resulting sessions; this helper just triggers them

  **Must NOT do**:
  - No `Target.sendMessageToTarget` (G4)
  - No target-type whitelist (G23)
  - No depth limit (G23)
  - No predicate (G23)
  - No detach helper in v1 (lifecycle handled by Scope close)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: recursive subscription pattern + lifecycle
  - **Skills**: [`effect-ts`] — Reason: scoped forked recursion

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 4
  - **Blocks**: T29, T34
  - **Blocked By**: T16, T23

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-setAutoAttach`, `attachToTarget`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] `grep -n 'sendMessageToTarget' src/` → exit 1 (G4 enforced)
  - [ ] `attach()` returns valid SessionId observable in registry
  - [ ] `autoAttach()` enabled → opening a child iframe surfaces a session in registry (T34 covers)

  **QA Scenarios** (full validation in T34):

  ```
  Scenario: attach returns sessionId present in registry
    Tool: Bash + Real Chromium
    Steps:
      1. discovery.list() → first targetId
      2. sessionId = attach(targetId)
      3. Assert registry.get(sessionId) !== None within 100ms
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-28-attach-registers.txt
  ```

  **Commit**: YES
  - Message: `feat(helpers): Target.attach + recursive autoAttach via flatten:true`
  - Files: `src/helpers/Target.ts`
  - Pre-commit: `bun run ts:check`

- [x] 29. `scripts/smoke.ts` default sub-test (AC1)

  **What to do**:
  - Entry: parse `--test-*` flag, default runs full flow
  - Default flow: HttpDiscovery.version → list → first page targetId → attach → Runtime.evaluate('1+1', Schema.Number) → assert === 2 → Page.goto(data URL with button) → querySelector → click → Runtime.evaluate('document.title', Schema.String) → assert correct → exit 0
  - Use `Cdp.layerBun(config)` (Bun runtime per AC1)
  - On any failure: log via `Effect.logError` (domain event), `Effect.exit(1)`
  - Connect via `webSocketDebuggerUrl` from `/json/version` (not hardcoded)

  **Must NOT do**:
  - No hardcoded WS URL (use discovery)
  - No `try/catch` (use Effect typed errors)
  - No `process.exit` direct — use `Effect.exitCode`
  - No `Schema.Unknown`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: integration of every helper, exit-code discipline
  - **Skills**: [`effect-ts`, `agent-browser`] — Reason: real Chromium orchestration

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T22-T28

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/#endpoints`

  **Acceptance Criteria**:
  - [ ] AC1: `bun scripts/smoke.ts` against real chromium ws://localhost:9222 → exit 0
  - [ ] Runs end-to-end in <10s
  - [ ] Output line: `OK 1+1=2` and `OK click registered`

  **QA Scenarios**:

  ```
  Scenario: Default smoke green (AC1)
    Tool: Bash + Real Chromium
    Preconditions: `chromium --remote-debugging-port=9222 --headless &` running
    Steps:
      1. `bun scripts/smoke.ts 2>&1 | tee /tmp/smoke.txt`
      2. Assert exit 0
      3. `grep -q 'OK 1+1=2' /tmp/smoke.txt`
      4. `grep -q 'OK click registered' /tmp/smoke.txt`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-29-default-smoke.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): default sub-test exercising every v1 helper`
  - Files: `scripts/smoke.ts`
  - Pre-commit: skip (requires live chromium; run in F3)

- [x] 30. smoke `--test-disconnect` (AC4)

  **What to do**:
  - Sub-test: spawn `chromium --remote-debugging-port=9222 --headless` as child process (or use existing if `--keep-chromium`)
  - Connect, send `Runtime.evaluate('new Promise(()=>{})', Schema.Json)` (never resolves)
  - In parallel fiber: after 500ms SIGKILL the chromium PID
  - Assert: send fails with `CdpDisconnected({reason:'SocketClosed'})` within 2s of SIGKILL
  - Use `Effect.catchTag('CdpDisconnected', ...)` (G14)
  - Exit 0 on assertion, 1 on miss

  **Must NOT do**:
  - No `_tag in error` probing (G14)
  - No `try/catch` for the disconnect (must be in Effect channel)
  - No `process.kill` outside Effect (use Effect-wrapped child_process)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: process management + race timing
  - **Skills**: [`effect-ts`, `agent-browser`] — Reason: child process + CDP

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T22

  **References**:
  - Pattern: `.repos/effect/packages/platform-node/src/NodeChildProcessSpawner.ts` — child process spawner via Effect

  **Acceptance Criteria**:
  - [ ] AC4: exit 0
  - [ ] Time from SIGKILL to CdpDisconnected ≤ 2s (measured + logged)
  - [ ] Reason field === 'SocketClosed'

  **QA Scenarios**:

  ```
  Scenario: SIGKILL surfaces CdpDisconnected
    Tool: Bash
    Steps:
      1. `bun scripts/smoke.ts --test-disconnect 2>&1 | tee /tmp/d.txt`
      2. exit 0
      3. `grep -E 'CdpDisconnected.*SocketClosed.*[0-9]+ms' /tmp/d.txt`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-30-disconnect.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): --test-disconnect verifies CdpDisconnected within 2s of SIGKILL`
  - Files: `scripts/smoke.ts` (extend)
  - Pre-commit: skip

- [x] 31. smoke `--test-detach` (AC5)

  **What to do**:
  - Sub-test: attach to a page, open a child target via `Target.createTarget({url:'about:blank'})`, attach to it
  - Send a Runtime.evaluate that never resolves on the CHILD session
  - Detach the child via `Target.detachFromTarget({sessionId:child})`
  - Assert: child-session send fails with `CdpDisconnected({reason:'TargetDetached'})` within 500ms
  - Parent session remains usable (assert `Runtime.evaluate('1', Schema.Number) === 1` succeeds after detach)

  **Must NOT do**:
  - No assumption about event ordering between detach event and pending failure (drain must happen first by T18 rule)
  - No reuse of detached sessionId

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`effect-ts`, `agent-browser`]

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T22, T23

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-detachFromTarget`

  **Acceptance Criteria**:
  - [ ] AC5: exit 0, child fails with TargetDetached within 500ms, parent still works

  **QA Scenarios**:

  ```
  Scenario: Detach fails child only
    Tool: Bash
    Steps:
      1. `bun scripts/smoke.ts --test-detach`
      2. exit 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-31-detach.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): --test-detach verifies session-scoped drain`
  - Files: `scripts/smoke.ts`
  - Pre-commit: skip

- [x] 32. smoke `--test-timeout` (AC10)

  **What to do**:
  - Sub-test: send `Runtime.evaluate('new Promise(()=>{})', Schema.Json, {timeout: Duration.millis(200)})`
  - Assert: fails with `CdpTimeout._tag` and `durationMs >= 200`
  - Capture pending map size before+after (expose test hook on Cdp service `__testPendingSize` gated by env var)
  - Assert: pending size returns to 0 after timeout

  **Must NOT do**:
  - No `__testPendingSize` exposed in production (env-gated)
  - No flake — use Duration.millis(200), tolerance 300ms total

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`effect-ts`]

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T19

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Duration.ts`

  **Acceptance Criteria**:
  - [ ] AC10: exit 0, CdpTimeout raised, pending size 0 after

  **QA Scenarios**:

  ```
  Scenario: Timeout cleans pending
    Tool: Bash
    Steps:
      1. `EFFECT_CDP_TEST=1 bun scripts/smoke.ts --test-timeout 2>&1 | tee /tmp/t.txt`
      2. exit 0
      3. `grep -E 'CdpTimeout.*durationMs=2[0-9][0-9]' /tmp/t.txt`
      4. `grep -q 'pending=0' /tmp/t.txt`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-32-timeout-cleanup.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): --test-timeout verifies CdpTimeout cleans pending map`
  - Files: `scripts/smoke.ts`
  - Pre-commit: skip

- [x] 33. smoke `--test-backpressure` (AC8)

  **What to do**:
  - Sub-test: attach page, `Page.goto` to data URL that emits 1000+ `console.log` calls fast (e.g. `for(let i=0;i<2000;i++)console.log(i)`)
  - Do NOT subscribe to events stream until 200ms after navigation (slow subscriber simulation)
  - Read metric `cdp_events_dropped_total` value
  - Assert: value > 0, process did NOT deadlock (exit within 5s)
  - Use `Metric.value` to read counter

  **Must NOT do**:
  - No retry on event drop
  - No assumption on exact drop count
  - No flaky tolerance > 5s

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`effect-ts`, `observability`]

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T13

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/Metric.ts` — `value`

  **Acceptance Criteria**:
  - [ ] AC8: exit 0 within 5s, drop counter > 0

  **QA Scenarios**:

  ```
  Scenario: Backpressure observable
    Tool: Bash
    Steps:
      1. `timeout 6 bun scripts/smoke.ts --test-backpressure 2>&1 | tee /tmp/bp.txt; echo "exit=$?" >> /tmp/bp.txt`
      2. `grep -q 'exit=0' /tmp/bp.txt` (not 124 from timeout)
      3. `grep -E 'cdp_events_dropped_total=[1-9][0-9]*' /tmp/bp.txt`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-33-backpressure.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): --test-backpressure proves drop metric and no deadlock`
  - Files: `scripts/smoke.ts`
  - Pre-commit: skip

- [x] 34. smoke `--test-multi-session` (AC9)

  **What to do**:
  - Sub-test: attach to 2 distinct page targets (create one if needed via discovery.newTab)
  - Concurrently `Runtime.evaluate('Math.random()')` on both sessions, capture results
  - Subscribe to each session's events stream
  - On session A: navigate to data URL emitting `console.log('A')`
  - On session B: navigate to data URL emitting `console.log('B')`
  - Collect events for 1s on each stream
  - Assert: A's stream contains only A's events (no B leakage), B's stream contains only B's events
  - Assert: random results are different (sanity — truly separate sessions)

  **Must NOT do**:
  - No global event subscription (must use Cdp.session(id).events)
  - No timing race assumptions — wait for navigation complete before asserting

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`effect-ts`, `agent-browser`]

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T23, T28

  **References**:
  - External: CDP Target.createTarget

  **Acceptance Criteria**:
  - [ ] AC9: exit 0, zero cross-session leakage

  **QA Scenarios**:

  ```
  Scenario: Session isolation
    Tool: Bash
    Steps:
      1. `bun scripts/smoke.ts --test-multi-session 2>&1 | tee /tmp/ms.txt`
      2. exit 0
      3. `grep -E 'A:events=[0-9]+ B-leaked=0' /tmp/ms.txt`
      4. `grep -E 'B:events=[0-9]+ A-leaked=0' /tmp/ms.txt`
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-34-multi-session.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): --test-multi-session proves session-scoped event routing`
  - Files: `scripts/smoke.ts`
  - Pre-commit: skip

- [x] 35. smoke `--test-discovery` (AC11)

  **What to do**:
  - Sub-test: HttpDiscovery.version() → assert response has fields `Browser`, `Protocol-Version`, `webSocketDebuggerUrl` (decoded via Schema)
  - HttpDiscovery.list() → assert array length ≥ 1, first item has `id`, `type`, `webSocketDebuggerUrl`
  - HttpDiscovery.newTab('about:blank') → assert decoded targetId returned
  - HttpDiscovery.close(newTargetId) → assert success (status 200)
  - Exit 0

  **Must NOT do**:
  - No retry (G24)
  - No raw fetch (use HttpDiscovery service)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`effect-ts`]

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T4

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/#endpoints`

  **Acceptance Criteria**:
  - [ ] AC11: exit 0, all 4 endpoints exercised

  **QA Scenarios**:

  ```
  Scenario: All discovery endpoints decode
    Tool: Bash
    Steps:
      1. `bun scripts/smoke.ts --test-discovery`
      2. exit 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-35-discovery.txt
  ```

  **Commit**: YES
  - Message: `test(smoke): --test-discovery exercises all /json endpoints`
  - Files: `scripts/smoke.ts`
  - Pre-commit: skip

- [x] 36. Helper: `Form` (`type`, `fill`, `press`)

  **What to do**:
  - `src/helpers/Form.ts`:
    - `type(sessionId, text: string)`: for each char → `Input.dispatchKeyEvent({type:'keyDown',text:c})` + `keyUp`
    - `fill(sessionId, nodeId: NodeId, value: string)`: `DOM.focus({nodeId})` → set element.value via `Runtime.evaluate` decoded as Schema.Void — actually CDP-cleanest: `DOM.setAttributeValue` for inputs, but for full compatibility use `Runtime.callFunctionOn` on resolved nodeId; pick simpler path via `Runtime.evaluate` with selector lookup
    - `press(sessionId, key: string)`: `Input.dispatchKeyEvent({type:'keyDown', key, code, windowsVirtualKeyCode})` + `keyUp`. Use minimal keymap (Enter, Tab, Escape, ArrowKeys); throw `CdpProtocolError({code:-1,message:'Unsupported key: '+key, method:'Input.dispatchKeyEvent'})` for unmapped

  **Must NOT do**:
  - No full keyboard layout (G22 — minimal keys only)
  - No combo-keys (no Ctrl+A handling)
  - No clipboard simulation

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`effect-ts`]

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 5
  - **Blocks**: F3
  - **Blocked By**: T23, T27

  **References**:
  - External: `https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent`

  **Acceptance Criteria**:
  - [ ] `bun run ts:check` zero errors
  - [ ] Unsupported key → CdpProtocolError
  - [ ] `type('hi')` produces 4 events (2 chars × down+up)

  **QA Scenarios**:

  ```
  Scenario: type+press round-trip via input element
    Tool: Bash + Real Chromium
    Steps:
      1. Page.goto data URL with `<input id=i>`
      2. querySelector → nodeId of #i
      3. focus(nodeId) — via fill helper or DOM.focus directly
      4. type('hello')
      5. Runtime.evaluate('document.getElementById("i").value', Schema.String) === 'hello'
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-36-type-roundtrip.txt
  ```

  **Commit**: YES
  - Message: `feat(helpers): Form (type, fill, press) via Input.dispatchKeyEvent`
  - Files: `src/helpers/Form.ts`
  - Pre-commit: `bun run ts:check`

- [ ] 37b. ADR-001: Custom dispatcher vs @effect/rpc adapter

  **What to do**:
  - `docs/adr/001-custom-dispatcher.md`
  - Section 1 — Context: CDP wire (`{id,method,params?,sessionId?}` request → `{id,result|error,sessionId?}` response; events are `{method,params?,sessionId?}` with NO id).
  - Section 2 — Options considered: (A) fully custom dispatcher (PendingMap+EventBus); (B) `@effect/rpc` via `makeNoSerialization` adapter; (C) hybrid (Rpc commands + custom EventBus).
  - Section 3 — Evidence with `.repos/effect` line citations:
    - `RpcMessage.ts:51` — `RequestId = Branded<bigint, ...>` (JSON.stringify chokes on bigint)
    - `RpcMessage.ts:200` — `FromServerEncoded` has no event/notification variant; every variant carries `requestId`
    - `RpcMessage.ts:69` — `RequestEncoded` has no `sessionId` field (would need Headers extension)
    - `RpcClient.ts:234` — `makeNoSerialization` is the escape hatch but events must still bypass Rpc entirely
    - Search for `event|notification|push` in RpcMessage.ts → 0 hits
  - Section 4 — Cost-benefit: adapter ≈ 150 LOC + dual codegen + EventBus still custom; custom ≈ 80 LOC PendingMap+EventBus, single mental model. Net: custom wins ~70 LOC + cognitive load.
  - Section 5 — Decision: Option (A) custom. Revisit if v2 needs Rpc.Middleware ecosystem.
  - Section 6 — Consequences: G27 service pattern matches how Rpc internally wires `Protocol` (same Context.Service primitives). No future migration penalty.
  - 1 page max.

  **Must NOT do**:
  - No mention of considering Rpc as a polite courtesy — cite real numbers
  - No `@effect/rpc` dep in package.json (cross-check T1)
  - No claim about Rpc that isn't backed by a `.repos/effect/packages/effect/src/unstable/rpc/*.ts:LINE` reference

  **Recommended Agent Profile**:
  - **Category**: `writing` — Reason: architectural decision record
  - **Skills**: [`effect-ts`] — Reason: Effect v4 Rpc API knowledge for accurate citations

  **Parallelization**:
  - **Can Run In Parallel**: YES — Wave 6 (alongside T37)
  - **Blocks**: F1 (compliance audit will check ADR exists)
  - **Blocked By**: None functionally

  **References**:
  - Pattern: `.repos/effect/packages/effect/src/unstable/rpc/RpcMessage.ts`
  - Pattern: `.repos/effect/packages/effect/src/unstable/rpc/RpcClient.ts`
  - Repo: AGENTS.md — never-invent rule + debundle/latest verification

  **Acceptance Criteria**:
  - [ ] `test -f docs/adr/001-custom-dispatcher.md`
  - [ ] Word count ≤ 1000
  - [ ] All Rpc claims have `.repos/effect/...:LINE` citations: `grep -cE '\.repos/effect.*\.ts:[0-9]+' docs/adr/001-custom-dispatcher.md` ≥ 5
  - [ ] `grep -c '@effect/rpc' package.json` → 0 (dep not added)

  **QA Scenarios**:

  ```
  Scenario: ADR cites real code
    Tool: Bash
    Steps:
      1. `grep -oE '\.repos/effect/[^ ]+\.ts:[0-9]+' docs/adr/001-custom-dispatcher.md | sort -u > /tmp/refs.txt`
      2. For each ref in /tmp/refs.txt, verify path exists and line N is within file length
      3. All refs valid
    Expected Result: every cited file:line resolves on disk
    Evidence: .omo/evidence/task-37b-adr-citations.txt
  ```

  **Commit**: YES
  - Message: `docs(adr): 001 custom dispatcher rationale`
  - Files: `docs/adr/001-custom-dispatcher.md`
  - Pre-commit: none

- [x] 37. README + AGENTS.md + ADR-001 (analysis methodology, never-invent, debundle/latest, custom-dispatcher rationale)

  **What to do**:
  - `README.md`: 1 page — install, quickstart (5 lines wiring Cdp.layerBun + 1 helper call), feature matrix, v1 scope OUT list (link guardrails), backpressure note, errors table (4 typed)
  - `AGENTS.md` (already exists, EXTEND): add `## Analyzing CDP behavior` section documenting how to inspect debundled chromium sources / latest CDP spec when behavior is unclear (never invent: check `.repos/effect`, devtools-protocol json, chromium source, in that order)
  - Document `__testPendingSize` env-gated test hook (T32)
  - Document drop metric name + suggested alert

  **Must NOT do**:
  - No emoji in README (unless explicitly requested)
  - No marketing language
  - No badges (greenfield, no CI yet)
  - No invented APIs in code examples — must compile against actual exports

  **Recommended Agent Profile**:
  - **Category**: `writing` — Reason: docs
  - **Skills**: [`logging-best-practices`] — Reason: structured event guidance in backpressure section

  **Parallelization**:
  - **Can Run In Parallel**: NO — Wave 6 (after Wave 5)
  - **Blocks**: F1
  - **Blocked By**: T29-T36 (need working API to write accurate examples)

  **References**:
  - Repo: AGENTS.md — vendored repos rule, Effect v4 conventions
  - Memory: never invent, always check debundle/latest (LTM)

  **Acceptance Criteria**:
  - [ ] README ≤ 1 page in raw markdown (~150 lines)
  - [ ] Quickstart example compiles: extract code block → `bunx tsc --noEmit --strict /tmp/quickstart.ts` → zero errors
  - [ ] AGENTS.md `## Analyzing CDP behavior` section exists
  - [ ] No invented APIs: every fn called in README exists in `src/index.ts` exports

  **QA Scenarios**:

  ```
  Scenario: Quickstart compiles
    Tool: Bash
    Steps:
      1. Extract first triple-backtick ts block from README
      2. Write to /tmp/quickstart.ts
      3. `bunx tsc --noEmit --strict --module nodenext --moduleResolution nodenext /tmp/quickstart.ts` → exit 0
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-37-quickstart-compiles.txt

  Scenario: Every README API exists
    Tool: Bash + bun -e
    Steps:
      1. Grep API identifiers from README code blocks
      2. For each: `bun -e "import * as M from './src/index.ts'; if (!('<name>' in M)) process.exit(1)"` → all pass
    Expected Result: All assertions in Steps above pass (each step's expected behavior; nonzero exit or failing grep = fail)
    Evidence: .omo/evidence/task-37-no-invented.txt
  ```

  **Commit**: YES
  - Message: `docs: README quickstart + AGENTS.md CDP analysis methodology`
  - Files: `README.md`, `AGENTS.md`
  - Pre-commit: `bun run ts:check` (quickstart extraction script)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
      Read this plan end-to-end. For each "Must Have": verify implementation exists (read file, run command, decode schema). For each "Must NOT Have" G1-G26: search codebase for forbidden patterns — reject with file:line if found. Check `.omo/evidence/` files exist for every task. Compare deliverables 1:1 with plan.
      Output: `Must Have [N/N] | Must NOT Have [26/26] | Tasks [37/37] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
      Run `bun run ts:check`, `bun test`, `bun run codegen && git diff --exit-code src/generated/`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, `console.*` in error paths, commented-out code, unused imports, `Effect.orDie`, `Schema.Unknown`, `bigint` in wire id, `export default`. Check AI slop: excessive comments, generic names.
      Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Codegen-idempotent [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [~] F3. **Real Manual QA** — `unspecified-high`
  Launch real Chromium: `bun x @puppeteer/browsers install chromium && chromium --remote-debugging-port=9222 --headless`. Execute all 7 smoke sub-tests (default + 6 flags). Save outputs to `.omo/evidence/final-qa/`. Test cross-helper integration (Page.goto → DOM.click → Network.waitForResponse → Runtime.evaluate flow). Test edge cases: malformed CDP response (mock via local WS), session detach mid-send, oversized message (>1MB JSON).
  Output: `Sub-tests [7/7 pass] | Integration [PASS/FAIL] | Edge Cases [3/3] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
      For each task T1-T37: read "What to do" + "Must NOT do", read actual git diff for files claimed. Verify 1:1 — every spec item built, nothing beyond spec. Check G21-G26 scope-creep guardrails: no extra helpers, no codegen richness, no autoAttach predicates, no HttpClient retry. Detect cross-task contamination (e.g., T24 touching T28 files). Flag unaccounted file changes outside plan's deliverables list.
      Output: `Tasks [37/37 compliant] | Scope-creep [CLEAN/N] | Contamination [CLEAN/N] | Unaccounted [CLEAN/N] | VERDICT`

---

## Commit Strategy

Each task commits independently using Conventional Commits:

- `chore(scaffold): ...` for T1, config
- `feat(types): ...` for T2-T3
- `feat(discovery): ...` for T4
- `feat(codegen): ...` for T5, T8-T11, T15, T16
- `feat(socket): ...` for T12
- `feat(events): ...` for T13
- `feat(dispatcher): ...` for T14, T18-T21
- `feat(service): ...` for T22-T23
- `feat(helpers): ...` for T24-T28, T36
- `test(smoke): ...` for T29-T35
- `docs: ...` for T37

Pre-commit per task: `bun run ts:check && bun test` (when tests exist).

---

## Success Criteria

### Verification Commands

```bash
bun install
bun run codegen                              # → src/generated/*.ts
git diff --exit-code src/generated/          # AC3: idempotent
bun run ts:check                             # AC2: zero errors
bun test                                     # AC7: codegen unit tests pass
bun scripts/check-codegen.ts                 # AC6: satisfies ProtocolMapping

# Start real Chromium first:
chromium --remote-debugging-port=9222 --headless &

bun scripts/smoke.ts                         # AC1
bun scripts/smoke.ts --test-disconnect       # AC4
bun scripts/smoke.ts --test-detach           # AC5
bun scripts/smoke.ts --test-backpressure     # AC8
bun scripts/smoke.ts --test-multi-session    # AC9
bun scripts/smoke.ts --test-timeout          # AC10
bun scripts/smoke.ts --test-discovery        # AC11
```

### Final Checklist

- [x] All AC1-AC11 pass
- [x] All G1-G26 guardrails enforced (F1+F4 verify)
- [x] All 37 tasks have evidence files in `.omo/evidence/`
- [x] F1-F4 all APPROVE
- [x] User explicit "okay" before marking complete
