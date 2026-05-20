import { Effect, Predicate, Ref, Schema, Stream } from "effect";

import { CdpDisconnected, CdpProtocolError } from "../errors.js";
import { CdpRequestId, SessionId } from "../types.js";
import type { EventBus } from "./eventBus.js";
import type { PendingMap } from "./pending.js";
import type { SocketBridge } from "./socketBridge.js";

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number => typeof value === "number";

const isJson = (value: unknown): value is Schema.Json => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (Predicate.isObject(value)) {
    return Object.values(value).every(isJson);
  }
  return false;
};

const sessionIdFromFrame = (frame: {
  readonly [x: PropertyKey]: unknown;
}): SessionId | undefined =>
  isString(frame["sessionId"])
    ? SessionId.makeUnsafe(frame["sessionId"])
    : undefined;

const sessionIdFromDetachedEvent = (frame: {
  readonly [x: PropertyKey]: unknown;
}): SessionId | undefined => {
  const params = Predicate.isObject(frame["params"]) ? frame["params"] : {};
  return isString(params["sessionId"])
    ? SessionId.makeUnsafe(params["sessionId"])
    : sessionIdFromFrame(frame);
};

const isNoSessionProtocolError = (frame: {
  readonly [x: PropertyKey]: unknown;
}): boolean => {
  const error = Predicate.isObject(frame["error"]) ? frame["error"] : {};
  return error["message"] === "No session with given id";
};

const logDecodeFailure = Effect.fnUntraced(function* (
  counter: Ref.Ref<number>,
  raw: string,
  error: unknown,
) {
  const count = yield* Ref.updateAndGet(counter, (n) => n + 1);
  if (count % 10 === 0) {
    yield* Effect.logWarning("Failed to decode CDP frame", {
      raw,
      parseError: String(error),
    });
  }
});

const makeProtocolError = (
  frame: { readonly [x: PropertyKey]: unknown },
  sessionId: SessionId | undefined,
): CdpProtocolError => {
  const error = Predicate.isObject(frame["error"]) ? frame["error"] : {};
  const code = isNumber(error["code"]) ? error["code"] : 0;
  const message = isString(error["message"])
    ? error["message"]
    : "CDP protocol error";
  const method = isString(frame["method"]) ? frame["method"] : "Unknown";
  return sessionId === undefined
    ? new CdpProtocolError({ code, message, method })
    : new CdpProtocolError({ code, message, method, sessionId });
};

export const runDispatcher = Effect.fnUntraced(function* (
  bridge: SocketBridge,
  eventBus: EventBus["Service"],
  pending: PendingMap["Service"],
): Effect.fn.Return<void, CdpDisconnected> {
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  const decodeFailures = yield* Ref.make(0);

  const routeFrame = Effect.fnUntraced(function* (raw: string) {
    const parsed = yield* Schema.decodeUnknownEffect(
      Schema.UnknownFromJsonString,
    )(raw).pipe(
      Effect.catch((error) =>
        logDecodeFailure(decodeFailures, raw, error).pipe(Effect.asVoid),
      ),
    );

    if (parsed === undefined) {
      return;
    }
    if (!Predicate.isObject(parsed)) {
      yield* logDecodeFailure(
        decodeFailures,
        raw,
        "CDP frame is not an object",
      );
      return;
    }

    const method = parsed["method"];
    const id = parsed["id"];
    const hasMethod = isString(method);
    const hasId = isNumber(id);
    const hasError = Predicate.hasProperty(parsed, "error");
    const hasResult = Predicate.hasProperty(parsed, "result");
    const sessionId = sessionIdFromFrame(parsed);

    if (hasId && (hasError || hasResult)) {
      const requestId = CdpRequestId.makeUnsafe(id);
      if (hasError) {
        if (sessionId !== undefined && isNoSessionProtocolError(parsed)) {
          yield* pending.drainSession(sessionId, "TargetDetached");
          yield* pending.fail(
            requestId,
            new CdpDisconnected({ reason: "TargetDetached" }),
          );
        } else {
          yield* pending.fail(requestId, makeProtocolError(parsed, sessionId));
        }
      } else {
        yield* pending.complete(requestId, parsed["result"] ?? {});
      }
      return;
    }

    if (hasMethod) {
      if (method === "Target.detachedFromTarget") {
        const detachedSessionId = sessionIdFromDetachedEvent(parsed);
        if (detachedSessionId !== undefined) {
          yield* pending.drainSession(detachedSessionId, "TargetDetached");
        }
      }
      const params = parsed["params"];
      yield* eventBus.publish({
        method,
        params: isJson(params) ? params : {},
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    }
  });

  const run = Stream.runForEach(bridge.stream, (chunk) => {
    const raw =
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    return routeFrame(raw);
  });

  yield* run.pipe(Effect.tap(() => pending.drainAll("SocketClosed")));
});
