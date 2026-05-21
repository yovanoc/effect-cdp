import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Cdp, CdpConfig } from "../src/index.js";
import * as Target from "../src/generated/Target.js";
import { CdpContainer, TestContainerLive, cdpUrl } from "./TestContainer.js";

const TestLayer = Layer.unwrap(
  Effect.gen(function* () {
    const container = yield* CdpContainer;
    const config = CdpConfig.make({
      webSocketDebuggerUrl: cdpUrl(container),
      eventBufferSize: 256,
    });
    return Cdp.layerNode(config);
  }),
).pipe(Layer.provide(TestContainerLive));

it("integration test with testcontainers", async () => {
  const program = Effect.gen(function* () {
    const cdp = yield* Cdp;
    const { targetInfos } = yield* cdp.root.send(Target.getTargets, {});
    expect(Array.isArray(targetInfos)).toBe(true);
    return targetInfos;
  }).pipe(Effect.provide(TestLayer));

  const result = await Effect.runPromise(program);
  expect(Array.isArray(result)).toBe(true);
}, 15_000);
