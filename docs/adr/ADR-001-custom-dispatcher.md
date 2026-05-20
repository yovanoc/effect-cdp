# ADR-001: Custom Dispatcher Instead of @effect/rpc

**Status**: Accepted  
**Date**: 2026-05-20

## Context

We need a WebSocket-based client for the Chrome DevTools Protocol (CDP). CDP is a JSON-RPC protocol over WebSocket with these characteristics:

- Request-response with monotonically increasing request IDs
- Bidirectional event streaming (server pushes events without client request)
- Session multiplexing (multiple targets share one WebSocket, distinguished by `sessionId`)
- Raw JSON-RPC with no schema negotiation or code generation on the wire

Effect provides `@effect/rpc`, a first-party RPC framework with:

- Schema-driven request/response types
- Client/server generation from schemas
- Support for streaming via `Stream` and `SubscriptionRef`
- WebSocket transport support

## Decision

We will implement a **custom dispatcher** (`src/internal/send.ts`, `src/Cdp.ts`) instead of using `@effect/rpc`.

## Rationale

### 1. Session Multiplexing Mismatch

CDP multiplexes multiple sessions over a single WebSocket. Each message may include an optional `sessionId` field. `@effect/rpc` assumes one logical connection maps to one RPC client. Modeling CDP's multiplexing in `@effect/rpc` would require:

- A custom transport layer that manages session routing
- Session-aware request ID allocation
- Per-session event demultiplexing

This essentially reimplements the custom dispatcher anyway, just inside an `@effect/rpc` adapter.

### 2. Event Model Mismatch

CDP events are not RPC subscriptions. They are:

- Server-initiated (no client subscribe request)
- Unbounded streams with no ACK mechanism
- Dropped when client buffer overflows (backpressure via dropping)

`@effect/rpc` streaming is designed for request-initiated subscriptions with proper backpressure. Mapping CDP's fire-and-forget events would require significant adapter complexity.

### 3. Protocol Simplicity

CDP is raw JSON-RPC with a simple envelope:

```json
{"id": 1, "method": "Page.navigate", "params": {"url": "..."}}
{"id": 1, "result": {"frameId": "..."}}
```

The complexity of `@effect/rpc` (schema negotiation, versioning, batching) is unnecessary overhead for this fixed protocol.

### 4. Type Safety Without @effect/rpc

We achieve full type safety via:

- Effect Schema for request/response types (codegen'd from devtools-protocol)
- `CdpCommand<Params, Result>` bundle type holding method + param schema + result schema
- Effect's typed error channels for the 4 CDP error cases

The public API is still fully typed without needing `@effect/rpc`.

## Trade-offs

| Aspect            | Custom Dispatcher                  | @effect/rpc                    |
| ----------------- | ---------------------------------- | ------------------------------ |
| Lines of code     | ~200 (send.ts + pending.ts)        | ~50 adapter + @effect/rpc dep  |
| Runtime overhead  | Minimal (raw JSON parse/stringify) | Additional envelope processing |
| Maintenance       | We own the code                    | Upstream handles RPC logic     |
| Learning curve    | Domain-specific                    | Generic RPC patterns           |
| Future extensions | Full control                       | Constrained by @effect/rpc API |

## Consequences

**Positive**:

- Direct control over WebSocket lifecycle and reconnection
- Efficient event streaming without RPC subscription overhead
- Simple mental model: WebSocket → Queue → Stream
- No dependency on `@effect/rpc` (one less package to version-align)

**Negative**:

- We maintain ~200 lines of protocol logic
- No automatic batching or request deduplication (though CDP doesn't benefit much from these)
- Future team members must understand CDP's JSON-RPC specifics

## Implementation

The custom dispatcher lives in:

- `src/Cdp.ts` — Service definition and session management
- `src/internal/send.ts` — Request/response correlation via `HashMap<requestId, Deferred>`
- `src/internal/pending.ts` — Pending request tracking and cleanup on disconnect
- `src/CdpConnection.ts` — WebSocket lifecycle management

## References

- CDP Protocol: https://chromedevtools.github.io/devtools-protocol/
- @effect/rpc docs: https://effect.website/docs/rpc/introduction
- Related code: `src/Cdp.ts`, `src/internal/send.ts`, `src/CdpConnection.ts`
