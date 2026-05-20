import { Effect, Layer, Schema } from "effect";
import { Socket } from "effect/unstable/socket";
import { Cdp } from "../Cdp.js";
import { CdpConfig } from "../CdpConfig.js";
import { CdpConnection } from "../CdpConnection.js";

class WsImportFailed extends Schema.TaggedErrorClass<WsImportFailed>(
  "WsImportFailed",
)("WsImportFailed", {
  reason: Schema.String,
}) {}

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
              `Original error: ${e}`,
          }),
      }).pipe(Effect.orDie);
      const WS = wsModule.default ?? wsModule.WebSocket ?? wsModule;
      return (url: string, _protocols?: string | Array<string>) =>
        new WS(url, { headers }) as unknown as globalThis.WebSocket;
    }),
  );
