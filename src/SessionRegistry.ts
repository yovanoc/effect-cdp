import { Context, Effect, HashMap, Layer, Option, Ref } from "effect";

import type { SessionId, TargetId } from "./types.js";

export interface SessionRegistryEntry {
  readonly targetId: TargetId;
  readonly parentSessionId: Option.Option<SessionId>;
}

export class SessionRegistry extends Context.Service<
  SessionRegistry,
  {
    readonly attach: (
      sessionId: SessionId,
      targetId: TargetId,
      parentSessionId?: SessionId,
    ) => Effect.Effect<void>;
    readonly detach: (sessionId: SessionId) => Effect.Effect<void>;
    readonly get: (
      sessionId: SessionId,
    ) => Effect.Effect<Option.Option<SessionRegistryEntry>>;
    readonly getAll: () => Effect.Effect<ReadonlyArray<SessionId>>;
  }
>()("SessionRegistry") {
  static readonly make: Effect.Effect<SessionRegistry["Service"]> = Effect.gen(
    function* () {
      const sessions = yield* Ref.make(
        HashMap.empty<SessionId, SessionRegistryEntry>(),
      );

      const attach = Effect.fnUntraced(function* (
        sessionId: SessionId,
        targetId: TargetId,
        parentSessionId?: SessionId,
      ) {
        yield* Ref.update(
          sessions,
          HashMap.set(sessionId, {
            targetId,
            parentSessionId:
              parentSessionId === undefined
                ? Option.none()
                : Option.some(parentSessionId),
          }),
        );
      });

      const detach = Effect.fnUntraced(function* (sessionId: SessionId) {
        yield* Ref.update(sessions, HashMap.remove(sessionId));
      });

      const get = Effect.fnUntraced(function* (sessionId: SessionId) {
        return yield* Ref.get(sessions).pipe(
          Effect.map(HashMap.get(sessionId)),
        );
      });

      const getAll = Effect.fnUntraced(function* () {
        return Array.from(HashMap.keys(yield* Ref.get(sessions)));
      });

      return SessionRegistry.of({
        attach,
        detach,
        get,
        getAll,
      });
    },
  );

  static readonly layer: Layer.Layer<SessionRegistry> = Layer.effect(
    SessionRegistry,
    SessionRegistry.make,
  );
}
