# effect-cdp

## 0.1.6

### Patch Changes

- [#8](https://github.com/yovanoc/effect-cdp/pull/8) [`a24a83e`](https://github.com/yovanoc/effect-cdp/commit/a24a83ed605367bc4ce7c9497123776b6757315e) Thanks [@yovanoc](https://github.com/yovanoc)! - Prevent bundler from code-splitting platform imports (`@effect/platform-node`, `@effect/platform-bun`) by using variable-based `import()` that rolldown cannot statically analyse. Type aliases preserve full autocomplete without `as` casts.

## 0.1.5

### Patch Changes

- [#6](https://github.com/yovanoc/effect-cdp/pull/6) [`7bd369f`](https://github.com/yovanoc/effect-cdp/commit/7bd369f9f092a0bbcade2b1bbfaaf9a8a49fa8ec) Thanks [@yovanoc](https://github.com/yovanoc)! - Prevent bundler from code-splitting `@effect/platform-node` and `@effect/platform-bun` dynamic imports by adding `@rolldown-ignore` comments. Without this, the bundler creates chunks that reference `ioredis` which is unavailable in Cloudflare Workers.

## 0.1.4

### Patch Changes

- [`9ecc5b7`](https://github.com/yovanoc/effect-cdp/commit/9ecc5b7fbe4b7ec9883c8c9fb06c64e1908e4b8c) Thanks [@yovanoc](https://github.com/yovanoc)! - Fix worker startup crash by lazy-loading `@effect/platform-node` and `@effect/platform-bun` in `layerNode`/`layerBun` methods. Module-level imports caused `node:net` errors in Cloudflare Workers. Use `Effect.promise(() => import(...))` to defer loading until the layer is actually built.

## 0.1.3

### Patch Changes

- [`e661c49`](https://github.com/yovanoc/effect-cdp/commit/e661c49a007ef22e8236c554f724c83ac8972a58) Thanks [@yovanoc](https://github.com/yovanoc)! - Add `reconnect` option to `CdpConfig` for automatic connection retry with exponential backoff. When set, the initial WebSocket connection retries with `maxRetries` and `baseDelay` before failing.

## 0.1.2

### Patch Changes

- [`4f41c2d`](https://github.com/yovanoc/effect-cdp/commit/4f41c2ddbba94726775a0b89aac68f8ff4d9a614) Thanks [@yovanoc](https://github.com/yovanoc)! - Add `layerCloudflare` to `effect-cdp/layers/AuthWebSocket` — Cloudflare Workers compatible WebSocket upgrade via `fetch` with custom headers. Uses `Random` service for key generation and follows Effect generator patterns with `return yield*` for typed errors.

## 0.1.1

### Patch Changes

- [`f25077e`](https://github.com/yovanoc/effect-cdp/commit/f25077e23c482d9779864fe53f7e5f8657a7849f) Thanks [@yovanoc](https://github.com/yovanoc)! - Add `waitForRequest` helper to `effect-cdp/helpers/Network` — mirrors the existing `waitForResponse` pattern for observing outbound network requests via `Network.requestWillBeSent` events.

## 0.1.0

### Minor Changes

- [`ebc22ad`](https://github.com/yovanoc/effect-cdp/commit/ebc22ad14d40e73735cbe8e72b1699631e2cb8ef) Thanks [@yovanoc](https://github.com/yovanoc)! - Initial release: type-safe CDP client for Effect v4 with 58 generated domains, session multiplexing, event streaming, typed errors, Bun/Node runtimes, and auth WebSocket headers support.
