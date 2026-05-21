/**
 * Finalizer ordering note (Scope is LIFO):
 *
 * We must fail all pending deferreds with `ScopeFinalized` before closing the
 * socket so callers receive typed `CdpDisconnected` errors instead of generic
 * transport failures.
 *
 * Therefore we register finalizers in reverse of intended execution:
 * 1) register socket close first   -> runs last
 * 2) register pending drain second -> runs first
 */
import { Context, Duration, Effect, Layer, Scope } from "effect";
import { Socket } from "effect/unstable/socket";

import { CdpConfig } from "./CdpConfig.js";
import { SessionRegistry } from "./SessionRegistry.js";
import { runDispatcher } from "./internal/dispatcher.js";
import { EventBus } from "./internal/eventBus.js";
import { PendingMap } from "./internal/pending.js";
import { makeSocketBridge } from "./internal/socketBridge.js";

interface CdpConnectionShape {
  readonly socket: Socket.Socket;
  readonly eventBus: EventBus["Service"];
  readonly pending: PendingMap["Service"];
  readonly sessionRegistry: SessionRegistry["Service"];
}

const buildConnection = (
  socket: Socket.Socket,
  config: typeof CdpConfig.Type,
): Effect.Effect<CdpConnectionShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const bridge = yield* makeSocketBridge(socket);
    const eventBus = yield* EventBus.make(config.eventBufferSize);
    const pending = yield* PendingMap.make;
    const sessionRegistry = yield* SessionRegistry.make;

    const socketClose = Effect.gen(function* () {
      const writer = yield* socket.writer;
      yield* writer(new Socket.CloseEvent(1000)).pipe(Effect.ignore);
    }).pipe(Effect.ignore, Effect.andThen(bridge.close));
    const pendingDrain = pending.drainAll("ScopeFinalized");

    // Register first so it runs last (LIFO).
    yield* Effect.addFinalizer(() => socketClose);
    // Register second so it runs first (LIFO).
    yield* Effect.addFinalizer(() => pendingDrain);

    yield* runDispatcher(bridge, eventBus, pending).pipe(Effect.forkScoped);

    return {
      socket,
      eventBus,
      pending,
      sessionRegistry,
    };
  });

export class CdpConnection extends Context.Service<
  CdpConnection,
  CdpConnectionShape
>()("CdpConnection", {
  make: Effect.fnUntraced(function* (config: typeof CdpConfig.Type) {
    const socket = yield* Socket.makeWebSocket(config.webSocketDebuggerUrl, {
      openTimeout: Duration.seconds(30),
    });
    return yield* buildConnection(socket, config);
  }),
}) {
  static readonly layerWithSocket = (
    config: typeof CdpConfig.Type,
    socketEffect: Effect.Effect<Socket.Socket, never, Scope.Scope>,
  ): Layer.Layer<CdpConnection> =>
    Layer.effect(
      CdpConnection,
      Effect.flatMap(socketEffect, (socket) => buildConnection(socket, config)),
    );

  static readonly layer = (
    config: typeof CdpConfig.Type,
    webSocketConstructor: Layer.Layer<Socket.WebSocketConstructor>,
  ): Layer.Layer<CdpConnection> =>
    Layer.effect(CdpConnection, CdpConnection.make(config)).pipe(
      Layer.provide(webSocketConstructor),
    );
}
