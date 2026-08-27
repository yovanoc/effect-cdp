import { Context, Deferred, Effect, HashMap, Layer, Option, Ref } from "effect";

import {
  CdpDecodeError,
  CdpDisconnected,
  CdpProtocolError,
  CdpTimeout,
} from "../errors.js";
import { CdpRequestId, type SessionId } from "../types.js";

type PendingDrainReason = CdpDisconnected["reason"];
type PendingError =
  | CdpProtocolError
  | CdpDecodeError
  | CdpDisconnected
  | CdpTimeout;

interface PendingEntry {
  readonly deferred: Deferred.Deferred<unknown, PendingError>;
  readonly sessionId: Option.Option<SessionId>;
  readonly method: string;
}

interface OpenState {
  readonly _tag: "Open";
  readonly entries: HashMap.HashMap<CdpRequestId, PendingEntry>;
  readonly counter: number;
}

interface ClosedState {
  readonly _tag: "Closed";
}

type PendingState = OpenState | ClosedState;

const openEmpty: OpenState = {
  _tag: "Open",
  entries: HashMap.empty<CdpRequestId, PendingEntry>(),
  counter: 0,
};

const closed: ClosedState = { _tag: "Closed" };

const disconnected = (reason: PendingDrainReason): CdpDisconnected =>
  new CdpDisconnected({ reason });

const matchesSession = (entry: PendingEntry, sessionId: SessionId): boolean =>
  Option.isSome(entry.sessionId) && entry.sessionId.value === sessionId;

export class PendingMap extends Context.Service<
  PendingMap,
  {
    readonly register: (
      id: CdpRequestId,
      sessionId: Option.Option<SessionId>,
      method: string,
    ) => Effect.Effect<
      Deferred.Deferred<unknown, PendingError>,
      CdpDisconnected
    >;
    readonly complete: (
      id: CdpRequestId,
      result: unknown,
    ) => Effect.Effect<void>;
    readonly fail: (
      id: CdpRequestId,
      error: PendingError,
    ) => Effect.Effect<void>;
    readonly cancel: (id: CdpRequestId) => Effect.Effect<void>;
    readonly drainAll: (reason: PendingDrainReason) => Effect.Effect<void>;
    readonly drainSession: (
      sessionId: SessionId,
      reason: PendingDrainReason,
    ) => Effect.Effect<void>;
    readonly nextId: Effect.Effect<CdpRequestId>;
  }
>()("effect-cdp/internal/PendingMap") {
  static readonly make: Effect.Effect<PendingMap["Service"]> = Effect.gen(
    function* () {
      const stateRef = yield* Ref.make<PendingState>(openEmpty);

      const register = Effect.fnUntraced(function* (
        id: CdpRequestId,
        sessionId: Option.Option<SessionId>,
        method: string,
      ) {
        const deferred = yield* Deferred.make<unknown, PendingError>();
        const result = yield* Ref.modify(
          stateRef,
          (state): [boolean, PendingState] => {
            if (state._tag === "Closed") {
              return [false, state];
            }
            const entries = HashMap.set(state.entries, id, {
              deferred,
              sessionId,
              method,
            });
            return [true, { _tag: "Open", entries, counter: state.counter }];
          },
        );
        if (!result) {
          return yield* disconnected("ScopeFinalized");
        }
        return deferred;
      });

      const takeEntry = (id: CdpRequestId) =>
        Ref.modify(
          stateRef,
          (state): [Option.Option<PendingEntry>, PendingState] => {
            if (state._tag === "Closed") {
              return [Option.none(), state];
            }
            const entry = HashMap.get(state.entries, id);
            if (Option.isNone(entry)) {
              return [Option.none(), state];
            }
            const entries = HashMap.remove(state.entries, id);
            return [entry, { _tag: "Open", entries, counter: state.counter }];
          },
        );

      const complete = Effect.fnUntraced(function* (
        id: CdpRequestId,
        result: unknown,
      ) {
        const entry = yield* takeEntry(id);
        if (Option.isSome(entry)) {
          yield* Deferred.succeed(entry.value.deferred, result);
        }
      });

      const fail = Effect.fnUntraced(function* (
        id: CdpRequestId,
        error: PendingError,
      ) {
        const entry = yield* takeEntry(id);
        if (Option.isSome(entry)) {
          yield* Deferred.fail(entry.value.deferred, error);
        }
      });

      const cancel = Effect.fnUntraced(function* (id: CdpRequestId) {
        yield* takeEntry(id);
      });

      const drainAll = Effect.fnUntraced(function* (
        reason: PendingDrainReason,
      ) {
        const previous = yield* Ref.getAndSet<PendingState>(stateRef, closed);
        if (previous._tag === "Closed") {
          return;
        }
        const error = disconnected(reason);
        yield* Effect.forEach(
          HashMap.values(previous.entries),
          (entry) => Deferred.fail(entry.deferred, error),
          { discard: true },
        );
      });

      const drainSession = Effect.fnUntraced(function* (
        sessionId: SessionId,
        reason: PendingDrainReason,
      ) {
        const entries = yield* Ref.modify(
          stateRef,
          (state): [ReadonlyArray<PendingEntry>, PendingState] => {
            if (state._tag === "Closed") {
              return [[], state];
            }
            const matching = Array.from(HashMap.values(state.entries)).filter(
              (entry) => matchesSession(entry, sessionId),
            );
            const remaining = HashMap.filter(
              state.entries,
              (entry) => !matchesSession(entry, sessionId),
            );
            return [
              matching,
              { _tag: "Open", entries: remaining, counter: state.counter },
            ];
          },
        );
        const error = disconnected(reason);
        yield* Effect.forEach(
          entries,
          (entry) => Deferred.fail(entry.deferred, error),
          { discard: true },
        );
      });

      const nextId = Ref.modify(stateRef, (state): [number, PendingState] => {
        if (state._tag === "Closed") {
          return [0, state];
        }
        const next = state.counter + 1;
        return [next, { _tag: "Open", entries: state.entries, counter: next }];
      }).pipe(Effect.map(CdpRequestId.makeUnsafe));

      return PendingMap.of({
        register,
        complete,
        fail,
        cancel,
        drainAll,
        drainSession,
        nextId,
      });
    },
  );

  static readonly layer: Layer.Layer<PendingMap> = Layer.effect(
    PendingMap,
    PendingMap.make,
  );
}
