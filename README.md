# effect-cdp

Type-safe [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) client for Effect, built on `@effect/platform` with full streaming and error handling.

## Install

```bash
bun add effect @effect/platform-bun @effect/platform-node
# or
npm install effect @effect/platform-bun @effect/platform-node
```

## Quickstart

```typescript
import { Effect, Layer, Stream } from "effect";
import { Cdp, CdpConfig } from "effect-cdp";
import * as Page from "effect-cdp/generated/Page.js";

const config = CdpConfig.make({
  webSocketDebuggerUrl: "ws://localhost:9222/devtools/browser/<id>",
  eventBufferSize: 256,
});

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;

  // Send a command
  const { targetId } = yield* cdp.root.send(Page.createTarget, {
    url: "about:blank",
  });

  // Get session and listen to events
  const session = cdp.session(targetId);
  const events = yield* Stream.runCollect(session.events);

  return events;
}).pipe(Effect.provide(Cdp.layerBun(config)));

Effect.runPromise(program);
```

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
