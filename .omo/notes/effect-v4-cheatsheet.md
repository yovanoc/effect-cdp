# Effect v4 Conventions Cheatsheet

Internal reference for codegen and service implementation. Source: `.repos/effect/LLMS.md` and Effect source code.

---

## 1. Effect.fnUntraced vs Effect.fn

Use `Effect.fnUntraced` for functions that only return `Effect.gen`. Use `Effect.fn` (with a span name matching the function name) when you need tracing spans.

**Rule**: An `Effect.fnUntraced` that only does `return yield* effect` is NOT allowed. Write the direct expression instead.

```ts
// Good - simple wrapper, no span needed
export const helper = Effect.fnUntraced(function*() { ... })

// Good - tracing required
export const tracedOp = Effect.fn("tracedOp")(function*() { ... })

// Bad - fnUntraced with only return yield*
const bad = Effect.fnUntraced(function*() {
  return yield* someEffect  // DON'T DO THIS
})
// Fixed: const good = someEffect
```

---

## 2. Schema.TaggedErrorClass

Define tagged errors with Schema for type-safe error handling.

```ts
export class MyError extends Schema.TaggedErrorClass<MyError>()("MyError", {
  message: Schema.String,
  reason: Schema.Literals("NotFound", "Invalid", "Timeout"),
}) {}
```

The `reason` field must use `Schema.Literals(...)` with PascalCase values. Always `return yield* new MyError({...})` when raising errors.

---

## 3. Layer.orDie Placement

ONLY use `Layer.orDie` on **final live compositions** whose remaining errors are truly unrecoverable. Converts typed errors to fiber death.

```ts
// Good - final composition only
const liveLayer = baseLayer.pipe(
  Layer.provide(dbLayer),
  Layer.orDie, // Errors here are unrecoverable
);

// Bad - intermediate layer
const intermediate = someLayer.pipe(Layer.orDie); // DON'T
```

Intermediate and test-exported layers must infer naturally. Never use on layers that callers might need to handle errors from.

---

## 4. PubSub.dropping Semantics

`PubSub.dropping(capacity)` drops **newest** messages when backlog fills.

- `publish(pubsub, msg)` returns `true` (accepted) or `false` (dropped)
- Each subscriber has its own backlog; when full, new messages drop
- Guarantees slow subscribers do not block publishers
- Use capacities that are powers of two for best performance

```ts
const pubsub = yield * PubSub.dropping<string>(100);
const accepted = yield * PubSub.publish(pubsub, msg); // boolean
```

---

## 5. Scope Finalizer LIFO Ordering

Finalizers run in **reverse order of registration** (LIFO).

```ts
yield * Scope.addFinalizer(scope, closeSocket); // registered 1st, runs LAST
yield * Scope.addFinalizer(scope, drainPending); // registered 2nd, runs FIRST
```

**Implication for sockets**: Register socket-close first (runs last), drain-pending second (runs first). This ensures pending messages drain before the socket closes.

---

## 6. Socket.run Callback Contract

`Socket.run` receives a handler callback with this contract:

```ts
run: <_, E, R>(
  handler: (_: Uint8Array) => Effect.Effect<_, E, R> | void,
  options?: { readonly onOpen?: Effect.Effect<void> },
) => Effect.Effect<void, SocketError | E, R>;
```

- Handler receives `Uint8Array` (binary) or use `runString` for strings
- Handler can return `void` (fire-and-forget) or an Effect
- Use `onOpen` for writes that must wait until connection opens
- Errors in handler propagate as `SocketError` on the run effect
- Handler runs in a scoped fiber set; each message dispatched to its own fiber

---

## 7. Queue.offerUnsafe vs Queue.offer

| Function            | Return            | Use When                            |
| ------------------- | ----------------- | ----------------------------------- |
| `Queue.offer`       | `Effect<boolean>` | Normal Effect workflows             |
| `Queue.offerUnsafe` | `boolean`         | Sync contexts (Socket.run handlers) |

Use `offerUnsafe` in `Socket.run` callbacks where you cannot yield:

```ts
socket.run((data) => {
  // In callback context - cannot yield
  const accepted = Queue.offerUnsafe(queue, data); // sync-safe
});
```

Both return `false` if queue is done or (for dropping queues) if message was dropped.

---

**Verify**: `fnUntraced TaggedError Layer.orDie PubSub.dropping Scope.*LIFO Socket.run offerUnsafe`

<!-- finalizer order: registered later run first -->
<!-- Pattern: Scope.*LIFO\|finalizer.*order -->

Scope.*LIFO|finalizer.*order
