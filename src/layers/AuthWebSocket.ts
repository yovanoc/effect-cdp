import { Effect, Layer, Random, Schema, Scope } from "effect";
import { Socket } from "effect/unstable/socket";
import { Cdp } from "../Cdp.js";
import { CdpConfig } from "../CdpConfig.js";
import { CdpConnection } from "../CdpConnection.js";

class WsImportFailed extends Schema.TaggedError<WsImportFailed>()(
  "WsImportFailed",
  {
    reason: Schema.String,
  },
) {}

/**
 * Creates a CDP layer that connects with custom WebSocket headers.
 *
 * This helper dynamically imports the `ws` library to create a WebSocket
 * with custom headers (e.g., `Authorization`). The `ws` package must be
 * installed separately:
 *
 * ```bash
 * bun add ws
 * # or
 * npm install ws
 * ```
 *
 * @since 1.0.0
 */
export const layerWithAuthHeaders = (
  config: typeof CdpConfig.Type,
  headers: Record<string, string>,
): Layer.Layer<Cdp, never, never> =>
  Layer.effect(Cdp, Cdp.make()).pipe(
    Layer.provide(CdpConnection.layer(config, makeWsConstructorLayer(headers))),
    Layer.orDie,
  );

const makeWsConstructorLayer = (
  headers: Record<string, string>,
): Layer.Layer<Socket.WebSocketConstructor> =>
  Layer.effect(
    Socket.WebSocketConstructor,
    Effect.gen(function* () {
      const wsModule = yield* Effect.tryPromise({
        try: () => import("ws"),
        catch: (e) =>
          new WsImportFailed({
            reason:
              `Failed to import "ws". Install it: bun add ws. ` +
              `Original error: ${String(e)}`,
          }),
      }).pipe(Effect.catchTag("WsImportFailed", Effect.die));
      const WS = wsModule.default ?? wsModule.WebSocket ?? wsModule;
      return (url: string, _protocols?: string | Array<string>) => {
        // SAFETY: `ws` implements the WebSocket surface consumed by Effect's socket bridge.
        return new WS(url, { headers }) as unknown as globalThis.WebSocket;
      };
    }),
  );

class WebSocketUpgradeFailed extends Schema.TaggedError<WebSocketUpgradeFailed>()(
  "WebSocketUpgradeFailed",
  {
    status: Schema.Int,
    body: Schema.String,
  },
) {}

const generateWebSocketKey = Effect.fnUntraced(function* () {
  const bytes = yield* Effect.all(
    Array.from({ length: 16 }, () => Random.nextIntBetween(0, 256)),
  );
  return btoa(String.fromCharCode(...bytes));
});

const fetchCloudflareWebSocket = Effect.fnUntraced(function* (
  httpUrl: string,
  headers: Record<string, string>,
) {
  const key = yield* generateWebSocketKey();

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(httpUrl, {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": key,
          "Sec-WebSocket-Version": "13",
          ...headers,
        },
      }),
    catch: (cause) => new Socket.SocketOpenError({ kind: "Unknown", cause }),
  });

  if (response.status !== 101) {
    const body = yield* Effect.promise(() => response.text().catch(() => ""));

    return yield* new WebSocketUpgradeFailed({
      status: response.status,
      body: body.slice(0, 200),
    });
  }

  // SAFETY: Cloudflare's 101 response carries a non-standard `webSocket` property.
  const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;

  if (!ws) {
    return yield* new WebSocketUpgradeFailed({
      status: response.status,
      body: "Response missing WebSocket",
    });
  }

  // SAFETY: Cloudflare's WebSocket exposes `accept` on upgraded responses.
  (ws as unknown as { accept(): void }).accept();

  return ws;
});

const makeCloudflareSocket = (
  httpUrl: string,
  headers: Record<string, string>,
): Effect.Effect<Socket.Socket, never, Scope.Scope> =>
  Effect.acquireRelease(fetchCloudflareWebSocket(httpUrl, headers), (ws) =>
    Effect.sync(() => ws.close(1000, "cleanup")),
  ).pipe(
    Effect.flatMap((ws) => Socket.fromWebSocket(Effect.succeed(ws))),
    Effect.catchTags({
      SocketOpenError: Effect.die,
      WebSocketUpgradeFailed: Effect.die,
    }),
  );

/**
 * Creates a CDP layer for Cloudflare Workers using the native
 * `fetch` WebSocket upgrade mechanism.
 *
 * Unlike {@link layerWithAuthHeaders}, this does not require the `ws` library.
 * It uses Cloudflare's non-standard `fetch` WebSocket response to obtain a
 * connected {@link WebSocket} directly.
 *
 * @example
 * ```ts
 * import { Cdp } from "effect-cdp"
 * import { layerCloudflare } from "effect-cdp/layers/AuthWebSocket"
 *
 * const cdpLayer = layerCloudflare(config, { Authorization: "Bearer my-token" })
 * ```
 *
 * @since 1.0.0
 */
export const layerCloudflare = (
  config: typeof CdpConfig.Type,
  headers: Record<string, string>,
): Layer.Layer<Cdp, never, never> =>
  Cdp.layerWithSocket(
    config,
    makeCloudflareSocket(config.webSocketDebuggerUrl, headers),
  );
