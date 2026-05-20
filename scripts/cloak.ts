import { Effect, Fiber, FileSystem, Stream } from "effect";
import { BunFileSystem, BunRuntime } from "@effect/platform-bun";
import { Cdp, CdpConfig } from "../src/index.js";
import * as Target from "../src/generated/Target.js";
import * as PageDomain from "../src/generated/Page.js";
import { goto } from "../src/helpers/Page.js";
import { SessionId } from "../src/types.js";

const config = CdpConfig.make({
  webSocketDebuggerUrl:
    "wss://cloak.cross-resell.com/api/profiles/38f3eb95-8ccb-4db8-be0a-3fccf9e74010/cdp",
  eventBufferSize: 256,
});

const mainEffect = Effect.gen(function* () {
  const cdp = yield* Cdp;
  const fs = yield* FileSystem.FileSystem;
  console.log("[cloak] connected, creating target...");
  const { targetId } = yield* cdp.root.send(Target.createTarget, {
    url: "about:blank",
  });
  console.log("[cloak] target created:", targetId);
  const sessionId = SessionId.makeUnsafe(targetId);
  const session = cdp.session(sessionId);
  const eventLogger = yield* Effect.forkChild(
    Stream.runForEach(session.events, (event) =>
      Effect.sync(() => console.log("[event]", event.method)),
    ),
  );
  yield* goto(cdp, sessionId, "https://vinted.fr");
  console.log("[cloak] page loaded, capturing screenshot...");
  const { data } = yield* session.send(PageDomain.captureScreenshot, {});
  const buffer = Buffer.from(data, "base64");
  yield* fs.writeFile("screenshot.png", buffer);
  console.log("[cloak] screenshot saved to screenshot.png");
  yield* Fiber.interrupt(eventLogger);
  return data;
});

const program = Effect.provide(mainEffect, [
  Cdp.layerBun(config),
  BunFileSystem.layer,
]);

if (import.meta.main) {
  BunRuntime.runMain(program);
}
