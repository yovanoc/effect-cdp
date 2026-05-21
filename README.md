# effect-cdp

Type-safe [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) client for [Effect](https://effect.website/), built on `@effect/platform` with full streaming and error handling.

Generated from the [devtools-protocol](https://github.com/chromedevtools/devtools-protocol) JSON schemas — 58 domains, typed commands, events, and results.

## Install

```bash
# Bun
bun add effect-cdp effect@beta @effect/platform-bun@beta

# Node.js
npm install effect-cdp effect@beta @effect/platform-node@beta
```

## Quickstart

### Bun

```typescript
import { Effect, Layer, Stream } from "effect";
import { Cdp, CdpConfig, SessionId } from "effect-cdp";
import * as Target from "effect-cdp/generated/Target.js";

const config = CdpConfig.make({
  webSocketDebuggerUrl: "ws://localhost:9222/devtools/browser/<id>",
  eventBufferSize: 256,
});

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;

  // Send a command
  const { targetId } = yield* cdp.root.send(Target.createTarget, {
    url: "about:blank",
  });

  // Get session and listen to events
  const session = cdp.session(SessionId.makeUnsafe(targetId));
  const events = yield* Stream.runCollect(session.events);

  return events;
}).pipe(Effect.provide(Cdp.layerBun(config)));

Effect.runPromise(program);
```

### Node.js

```typescript
import { Cdp } from "effect-cdp";

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;
  // ...
}).pipe(Effect.provide(Cdp.layerNode(config)));
```

## Auth Headers (e.g., Cloak, Browserless)

Some CDP proxies require `Authorization` headers on the WebSocket handshake. Install `ws` and use `layerWithAuthHeaders`:

```bash
bun add ws
```

```typescript
import { layerWithAuthHeaders } from "effect-cdp";

const cdpLayer = layerWithAuthHeaders(config, {
  Authorization: "Bearer <token>",
});

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;
  // ...
}).pipe(Effect.provide(cdpLayer));
```

## Cloudflare Workers

The `ws` library does not run in Cloudflare Workers. Use `layerCloudflare` instead — it performs the WebSocket upgrade via `fetch` with custom headers and accepts the socket from the 101 response:

```typescript
import { layerCloudflare } from "effect-cdp";

const cdpLayer = layerCloudflare(config, {
  Authorization: "Bearer <token>",
});

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;
  // ...
}).pipe(Effect.provide(cdpLayer));
```

This only works in runtimes that support Cloudflare's non-standard `fetch` WebSocket upgrade (e.g., Cloudflare Workers, Wrangler local dev).

## Reconnect

Connection drops happen. Add automatic reconnection with exponential backoff:

```typescript
const config = CdpConfig.make({
  webSocketDebuggerUrl: "ws://localhost:9222/devtools/browser/<id>",
  eventBufferSize: 256,
  reconnect: {
    maxRetries: 3,
    baseDelay: Duration.millis(1000),
  },
});

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;
  // ...
}).pipe(Effect.provide(Cdp.layerBun(config)));
```

When `reconnect` is set, the initial socket connection retries with exponential backoff before failing.
## Feature Matrix

| Feature                                   | Status | Notes                                    |
| ----------------------------------------- | ------ | ---------------------------------------- |
| Command/response                          | Ready  | Typed via Effect Schema                  |
| Event streaming                           | Ready  | `Stream.Stream<RawCdpEvent>` per session |
| Session multiplexing                      | Ready  | Multiple targets, one connection         |
| Error handling                            | Ready  | 4 typed errors (see below)               |
| Bun runtime                               | Ready  | `Cdp.layerBun(config)`                   |
| Node.js runtime                           | Ready  | `Cdp.layerNode(config)`                  |
| Helpers (`Page.goto`, `Runtime.evaluate`) | Ready  | Type-safe wrappers in `helpers/`         |
| Codegen (58 domains)                      | Ready  | Auto-generated from devtools-protocol    |

## v1 Scope OUT

These features are intentionally deferred to post-v1:

- Bidi/WebDriver BiDi protocol support
- Built-in session pooling
- Retry/circuit-breaker policies
- Request deduplication
- Browser download/management

## Backpressure Note

Event buffering uses a **dropping queue**. When `eventBufferSize` is exceeded, events are dropped and a metric counter `cdp_events_dropped_total` is incremented. If you need lossless event delivery, increase `eventBufferSize` or consume events faster than they are produced.

## Errors

All errors are typed `Schema.TaggedError` with a `_tag` discriminator:

| Error              | `_tag`             | When it occurs                                                  |
| ------------------ | ------------------ | --------------------------------------------------------------- |
| `CdpDisconnected`  | `CdpDisconnected`  | Socket closed, scope finalized, target detached, or peer killed |
| `CdpTimeout`       | `CdpTimeout`       | Command exceeds `timeout` duration                              |
| `CdpDecodeError`   | `CdpDecodeError`   | Response JSON cannot be decoded to expected schema              |
| `CdpProtocolError` | `CdpProtocolError` | CDP returns an error response (check `code` and `message`)      |

Handle errors with `Effect.catchTag`:

```typescript
yield *
  cdp.root
    .send(Page.navigate, { url })
    .pipe(
      Effect.catchTag("CdpTimeout", (err) =>
        Effect.log(`Navigation timed out after ${err.durationMs}ms`),
      ),
    );
```

## License

MIT
