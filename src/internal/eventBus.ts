import { Context, Effect, Fiber, Layer, Metric, Option, PubSub, Ref, Schema, Stream } from "effect"

import { SessionId } from "../types.js"

export const RawCdpEvent = Schema.Struct({
  method: Schema.String,
  params: Schema.Json,
  sessionId: Schema.optional(SessionId)
}).annotate({ identifier: "RawCdpEvent" })

export type RawCdpEvent = typeof RawCdpEvent.Type

export class EventBus extends Context.Service<EventBus, {
  readonly publish: (event: RawCdpEvent) => Effect.Effect<void>
  readonly subscribe: () => Stream.Stream<RawCdpEvent>
}>()("effect-cdp/internal/EventBus") {
  static readonly make = (eventBufferSize: number): Effect.Effect<EventBus["Service"]> =>
    Effect.gen(function*() {
      const pubsub = yield* PubSub.dropping<RawCdpEvent>(eventBufferSize)
      const droppedCounter = Metric.counter("cdp_events_dropped_total")
      const warningFiber = yield* Ref.make<Option.Option<Fiber.Fiber<void>>>(Option.none())

      const resetWarning = Effect.gen(function*() {
        yield* Effect.sleep("5 seconds")
        yield* Ref.set(warningFiber, Option.none())
      })

      const warnDrop = Effect.fnUntraced(function*() {
        const current = yield* Ref.get(warningFiber)
        if (Option.isSome(current)) {
          return
        }

        yield* Effect.logWarning("CDP events dropped due to backpressure")
        const fiber = yield* resetWarning.pipe(Effect.forkDetach)
        yield* Ref.set(warningFiber, Option.some(fiber))
      })

      const publish = Effect.fnUntraced(function*(event: RawCdpEvent) {
        const accepted = yield* PubSub.publish(pubsub, event)
        if (!accepted) {
          yield* Metric.update(droppedCounter, 1)
          yield* warnDrop()
        }
      })

      return EventBus.of({
        publish: (event) => publish(event),
        subscribe: () => Stream.fromPubSub(pubsub)
      })
    })

  static readonly layer = (eventBufferSize: number): Layer.Layer<EventBus> =>
    Layer.effect(EventBus, EventBus.make(eventBufferSize))
}
