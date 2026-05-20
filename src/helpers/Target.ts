import { Effect, Schema, Stream } from "effect";

import type { Cdp, CdpError } from "../Cdp.js";
import * as Target from "../generated/Target.js";
import { SessionId } from "../types.js";

export interface AutoAttachOptions {
  readonly waitForDebuggerOnStart?: boolean;
}

export const attach = Effect.fnUntraced(function* (
  cdp: Cdp["Service"],
  targetId: string,
) {
  const response = yield* cdp.root.send(Target.attachToTarget, {
    targetId,
    flatten: true,
  });
  return SessionId.makeUnsafe(response.sessionId);
});

const decodeAttachedToTargetParams = Schema.decodeUnknownOption(
  Target.attachedToTarget.params,
);

export const autoAttach = Effect.fnUntraced(function* (
  cdp: Cdp["Service"],
  opts?: AutoAttachOptions,
) {
  const waitForDebuggerOnStart = opts?.waitForDebuggerOnStart ?? false;

  yield* cdp.root.send(Target.setAutoAttach, {
    autoAttach: true,
    waitForDebuggerOnStart,
    flatten: true,
  });

  const setAutoAttachOnSession = (
    sessionId: SessionId,
  ): Effect.Effect<void, CdpError> =>
    cdp.session(sessionId).send(Target.setAutoAttach, {
      autoAttach: true,
      waitForDebuggerOnStart,
      flatten: true,
    });

  const subscription = cdp.events.pipe(
    Stream.filter((event) => event.method === Target.attachedToTarget.method),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const decoded = decodeAttachedToTargetParams(event.params);
        if (decoded._tag === "None") {
          return;
        }
        yield* setAutoAttachOnSession(
          SessionId.makeUnsafe(decoded.value.sessionId),
        );
      }),
    ),
  );

  yield* Effect.forkScoped(subscription);
});
