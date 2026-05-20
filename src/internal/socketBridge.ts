import { Cause, Effect, Queue, Stream } from "effect";
import { Socket } from "effect/unstable/socket";

export interface SocketBridge {
  readonly stream: Stream.Stream<string | Uint8Array>;
  readonly close: Effect.Effect<void>;
}

export const makeSocketBridge = Effect.fnUntraced(function* (
  socket: Socket.Socket,
) {
  const queue = yield* Queue.unbounded<string | Uint8Array, Cause.Done>();
  yield* Effect.forkScoped(
    socket
      .run((chunk) => {
        Queue.offerUnsafe(queue, chunk);
      })
      .pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(Queue.end(queue)),
      ),
  );
  return {
    stream: Stream.fromQueue(queue),
    close: Queue.shutdown(queue),
  } satisfies SocketBridge;
});
