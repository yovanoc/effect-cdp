# effect-cdp

## 0.1.2

### Patch Changes

- [`4f41c2d`](https://github.com/yovanoc/effect-cdp/commit/4f41c2ddbba94726775a0b89aac68f8ff4d9a614) Thanks [@yovanoc](https://github.com/yovanoc)! - Add `layerCloudflare` to `effect-cdp/layers/AuthWebSocket` — Cloudflare Workers compatible WebSocket upgrade via `fetch` with custom headers. Uses `Random` service for key generation and follows Effect generator patterns with `return yield*` for typed errors.

## 0.1.1

### Patch Changes

- [`f25077e`](https://github.com/yovanoc/effect-cdp/commit/f25077e23c482d9779864fe53f7e5f8657a7849f) Thanks [@yovanoc](https://github.com/yovanoc)! - Add `waitForRequest` helper to `effect-cdp/helpers/Network` — mirrors the existing `waitForResponse` pattern for observing outbound network requests via `Network.requestWillBeSent` events.

## 0.1.0

### Minor Changes

- [`ebc22ad`](https://github.com/yovanoc/effect-cdp/commit/ebc22ad14d40e73735cbe8e72b1699631e2cb8ef) Thanks [@yovanoc](https://github.com/yovanoc)! - Initial release: type-safe CDP client for Effect v4 with 58 generated domains, session multiplexing, event streaming, typed errors, Bun/Node runtimes, and auth WebSocket headers support.
