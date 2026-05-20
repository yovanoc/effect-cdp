import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import { Socket } from "effect/unstable/socket"

import { makeSocketBridge } from "../../src/internal/socketBridge.js"

const byteValues = (chunk: string | Uint8Array): ReadonlyArray<number> =>
  typeof chunk === "string" ? [] : Array.from(chunk)

const formatChunks = (chunks: ReadonlyArray<ReadonlyArray<number>>): string =>
  `[${chunks.map((chunk) => `[${chunk.join(",")}]`).join(",")}]`

const makeEchoSocket = (chunks: ReadonlyArray<Uint8Array>): Socket.Socket =>
  Socket.make({
    runRaw: () => Effect.never,
    run: (handler) =>
      Effect.gen(function* () {
        for (const chunk of chunks) {
          const result = handler(chunk)
          if (result !== undefined) {
            yield* result
          }
        }
      }),
    writer: Effect.succeed(() => Effect.void)
  })

const makeNeverSocket = (): Socket.Socket =>
  Socket.make({
    runRaw: () => Effect.never,
    run: () => Effect.never,
    writer: Effect.succeed(() => Effect.void)
  })

const echoOrder = Effect.scoped(
  Effect.gen(function* () {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]
    const bridge = yield* makeSocketBridge(makeEchoSocket(chunks))
    const values = yield* bridge.stream.pipe(Stream.take(chunks.length), Stream.runCollect)
    yield* bridge.close
    return values.map(byteValues)
  })
)

const scopeClose = Effect.gen(function* () {
  const fiber = yield* Effect.scoped(
    Effect.gen(function* () {
      const bridge = yield* makeSocketBridge(makeNeverSocket())
      return yield* bridge.stream.pipe(Stream.runDrain, Effect.forkScoped)
    })
  )
  const exit = yield* Fiber.await(fiber)
  return Exit.match(exit, {
    onFailure: (cause) => ({ interrupted: Cause.hasInterruptsOnly(cause) }),
    onSuccess: () => ({ interrupted: false })
  })
})

const main = Effect.gen(function* () {
  const mode = process.argv[2] ?? "echo-order"
  if (mode === "scope-close") {
    const closed = yield* scopeClose
    console.log(`scopeClose.interrupted=${closed.interrupted}`)
  } else {
    const echo = yield* echoOrder
    console.log(`echo=${formatChunks(echo)}`)
  }
})

Effect.runPromise(main)
