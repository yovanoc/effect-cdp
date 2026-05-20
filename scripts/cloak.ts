import { Effect, Fiber, Stream } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { BunFileSystem } from "@effect/platform-bun";
import { Cdp, CdpConfig } from "../src/index.js";
import * as Target from "../src/generated/Target.js";
import * as PageDomain from "../src/generated/Page.js";
import { goto } from "../src/helpers/Page.js";
import { SessionId } from "../src/types.js";
import { BunRuntime } from "@effect/platform-bun";

const config = CdpConfig.make({
  webSocketDebuggerUrl:
    "https://cloak.cross-resell.com/api/profiles/38f3eb95-8ccb-4db8-be0a-3fccf9e74010/cdp",
  eventBufferSize: 256,
});

const program = Effect.gen(function* () {
  const cdp = yield* Cdp;
  const fs = yield* FileSystem;

  const { targetId } = yield* cdp.root.send(Target.createTarget, {
    url: "about:blank",
  });

  const sessionId = SessionId.makeUnsafe(targetId);
  const session = cdp.session(sessionId);

  const eventLogger = yield* Effect.forkChild(
    Stream.runForEach(session.events, (event) => Effect.log(event)),
  );

  yield* goto(cdp, sessionId, "https://vinted.fr");

  const { data } = yield* session.send(PageDomain.captureScreenshot, {});

  const buffer = Buffer.from(data, "base64");
  yield* fs.writeFile("screenshot.png", buffer);

  yield* Fiber.interrupt(eventLogger);

  return data;
}).pipe(
  Effect.provide(Cdp.layerBun(config)),
  Effect.provide(BunFileSystem.layer),
);

if (import.meta.main) {
  BunRuntime.runMain(program);
}
