import { Deferred, Duration, Effect, Option, Predicate, Schema } from "effect";
import { Socket } from "effect/unstable/socket";

import {
  CdpDecodeError,
  CdpDisconnected,
  CdpProtocolError,
  CdpTimeout,
} from "../errors.js";
import { type CdpRequestId, type SessionId } from "../types.js";
import type { PendingMap } from "./pending.js";

type SendError =
  | CdpDisconnected
  | CdpTimeout
  | CdpProtocolError
  | CdpDecodeError;

const encodeFrame = Schema.encodeUnknownSync(
  Schema.fromJsonString(Schema.Json),
);

const timeoutError = (
  method: string,
  requestId: CdpRequestId,
  timeout: Duration.Duration,
): CdpTimeout =>
  new CdpTimeout({
    method,
    requestId,
    durationMs: Duration.toMillis(timeout),
  });

const shouldIncludeParams = (params: unknown): boolean =>
  params !== undefined &&
  Predicate.isObject(params) &&
  Object.keys(params).length > 0;

const shouldRouteFromRoot = (method: string, params: unknown): boolean =>
  method === "Target.detachFromTarget" &&
  Predicate.isObject(params) &&
  typeof params["sessionId"] === "string";

export const send = Effect.fnUntraced(function* (
  socket: Socket.Socket,
  pending: PendingMap["Service"],
  method: string,
  params: unknown,
  opts: {
    readonly sessionId?: SessionId;
    readonly timeout?: Duration.Duration;
  },
): Effect.fn.Return<unknown, SendError> {
  const id = yield* pending.nextId;
  const sessionId = shouldRouteFromRoot(method, params)
    ? undefined
    : opts.sessionId;
  const deferred = yield* pending.register(
    id,
    sessionId === undefined ? Option.none() : Option.some(sessionId),
    method,
  );

  const frame: Record<string, unknown> = { id, method };
  if (shouldIncludeParams(params)) {
    frame["params"] = params;
  }
  if (sessionId !== undefined) {
    frame["sessionId"] = sessionId;
  }

  yield* Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* socket.writer;
      yield* writer(encodeFrame(frame));
    }),
  ).pipe(
    Effect.catch(() => {
      const error = new CdpDisconnected({ reason: "SocketClosed" });
      return pending.fail(id, error).pipe(Effect.flatMap(() => error));
    }),
  );

  const awaitResponse = Deferred.await(deferred).pipe(
    Effect.ensuring(pending.cancel(id)),
  );
  if (opts.timeout === undefined) {
    return yield* awaitResponse;
  }

  const error = timeoutError(method, id, opts.timeout);
  return yield* awaitResponse.pipe(
    Effect.timeoutOrElse({
      duration: opts.timeout,
      orElse: () => pending.fail(id, error).pipe(Effect.flatMap(() => error)),
    }),
  );
});
