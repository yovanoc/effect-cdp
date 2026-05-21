import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Ref,
  Schema,
  Scope,
  Schedule,
  Stream,
} from "effect";
import { Socket } from "effect/unstable/socket";

import { CdpConfig } from "./CdpConfig.js";
import { CdpConnection } from "./CdpConnection.js";
import type { SessionRegistry } from "./SessionRegistry.js";
import {
  CdpDecodeError,
  CdpDisconnected,
  CdpProtocolError,
  CdpTimeout,
} from "./errors.js";
import { type RawCdpEvent } from "./internal/eventBus.js";
import { send as sendInternal } from "./internal/send.js";
import type { SessionId } from "./types.js";

export type CdpError =
  | CdpDecodeError
  | CdpDisconnected
  | CdpProtocolError
  | CdpTimeout;

export interface CdpCommand<Params = unknown, Result = unknown> {
  readonly method: string;
  readonly params: Schema.Schema<Params>;
  readonly result: Schema.Schema<Result>;
}

export interface CdpSendOptions {
  readonly sessionId?: SessionId;
  readonly timeout?: Duration.Duration;
}

export interface CdpSession {
  readonly send: <Params, Result>(
    cmd: CdpCommand<Params, Result>,
    params: Params,
    opts?: Omit<CdpSendOptions, "sessionId">,
  ) => Effect.Effect<Result, CdpError>;
  readonly events: Stream.Stream<RawCdpEvent>;
}

export interface CdpService {
  readonly send: <Params, Result>(
    cmd: CdpCommand<Params, Result>,
    params: Params,
    opts?: CdpSendOptions,
  ) => Effect.Effect<Result, CdpError>;
  readonly session: (sessionId: SessionId) => CdpSession;
  readonly root: CdpSession;
  readonly events: Stream.Stream<RawCdpEvent>;
  readonly registry: SessionRegistry["Service"];
  readonly __testPendingSize?: Effect.Effect<number>;
}

const renderRaw = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
};

const decodeError =
  (raw: unknown) =>
  (error: Schema.SchemaError): CdpDecodeError =>
    new CdpDecodeError({
      raw: renderRaw(raw),
      parseError: Cause.pretty(Cause.fail(error)),
    });

const effectFromExit = <A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> =>
  Exit.match(exit, {
    onSuccess: Effect.succeed,
    onFailure: Effect.failCause,
  });

export class Cdp extends Context.Service<Cdp, CdpService>()("Cdp", {
  make: Effect.fnUntraced(function* () {
    const connection = yield* CdpConnection;
    const testMode = process.env["EFFECT_CDP_TEST"] === "1";
    const pendingCounter = testMode ? yield* Ref.make(0) : undefined;

    const sendCommand = Effect.fnUntraced(function* <Params, Result>(
      cmd: CdpCommand<Params, Result>,
      params: Params,
      opts: CdpSendOptions = {},
    ): Effect.fn.Return<Result, CdpError> {
      const encodedParams = yield* effectFromExit(
        Schema.encodeExit(
          cmd.params as Schema.Codec<Params, unknown, never, never>,
        )(params),
      ).pipe(Effect.mapError(decodeError(params)));
      const sendEffect = sendInternal(
        connection.socket,
        connection.pending,
        cmd.method,
        encodedParams,
        opts,
      );
      const trackedSend =
        pendingCounter === undefined
          ? sendEffect
          : Effect.acquireUseRelease(
              Ref.update(pendingCounter, (n) => n + 1),
              () => sendEffect,
              () => Ref.update(pendingCounter, (n) => n - 1),
            );
      const rawResult = yield* trackedSend;
      return yield* effectFromExit(
        Schema.decodeUnknownExit(
          cmd.result as Schema.Codec<Result, unknown, never, never>,
        )(rawResult),
      ).pipe(Effect.mapError(decodeError(rawResult)));
    });

    const allEvents = connection.eventBus.subscribe();

    const root: CdpSession = {
      send: (cmd, params, opts) => sendCommand(cmd, params, opts),
      events: allEvents.pipe(
        Stream.filter((event) => event.sessionId === undefined),
      ),
    };

    const session = (sessionId: SessionId): CdpSession => ({
      send: (cmd, params, opts) =>
        sendCommand(cmd, params, { ...opts, sessionId }),
      events: allEvents.pipe(
        Stream.filter((event) => event.sessionId === sessionId),
      ),
    });

    const base: CdpService = {
      send: (cmd, params, opts) => sendCommand(cmd, params, opts),
      session,
      root,
      events: allEvents,
      registry: connection.sessionRegistry,
    };
    return pendingCounter === undefined
      ? base
      : { ...base, __testPendingSize: Ref.get(pendingCounter) };
  }),
}) {
  static readonly layerWithSocket = (
    config: typeof CdpConfig.Type,
    socketEffect: Effect.Effect<Socket.Socket, never, Scope.Scope>,
  ): Layer.Layer<Cdp, never, never> => {
    const socket = config.reconnect
      ? socketEffect.pipe(
          Effect.retry({
            schedule: Schedule.exponential(config.reconnect.baseDelay),
            times: config.reconnect.maxRetries,
          }),
        )
      : socketEffect;

    return Layer.effect(Cdp, Cdp.make()).pipe(
      Layer.provide(CdpConnection.layerWithSocket(config, socket)),
      Layer.orDie,
    );
  };

  static readonly layerNode = (
    config: typeof CdpConfig.Type,
  ): Layer.Layer<Cdp, never, never> =>
    Layer.effect(
      Cdp,
      Effect.gen(function* () {
        const { NodeSocket } = yield* Effect.promise(
          () => import(/* @rolldown-ignore */ "@effect/platform-node"),
        );
        return yield* Cdp.make().pipe(
          Effect.provide(
            CdpConnection.layer(config, NodeSocket.layerWebSocketConstructor),
          ),
        );
      }),
    ).pipe(Layer.orDie);

  static readonly layerBun = (
    config: typeof CdpConfig.Type,
  ): Layer.Layer<Cdp, never, never> =>
    Layer.effect(
      Cdp,
      Effect.gen(function* () {
        const { BunSocket } = yield* Effect.promise(
          () => import(/* @rolldown-ignore */ "@effect/platform-bun"),
        );
        return yield* Cdp.make().pipe(
          Effect.provide(
            CdpConnection.layer(config, BunSocket.layerWebSocketConstructor),
          ),
        );
      }),
    ).pipe(Layer.orDie);
}

export type { RawCdpEvent };
