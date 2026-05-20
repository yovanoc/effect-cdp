import { Effect, Fiber, Stream, Duration } from "effect";
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
    "wss://cloak.cross-resell.com/api/profiles/38f3eb95-8ccb-4db8-be0a-3fccf9e74010/cdp",
  eventBufferSize: 256,
});

const program = Effect.gen(function* () {
  console.log("[cloak] Starting...");

  const cdp = yield* Cdp;
  console.log("[cloak] CDP connected");

  const fs = yield* FileSystem;

  console.log("[cloak] Creating target...");
  const { targetId } = yield* cdp.root.send(Target.createTarget, {
    url: "about:blank",
  });
  console.log("[cloak] Target created:", targetId);

  const sessionId = SessionId.makeUnsafe(targetId);
  const session = cdp.session(sessionId);

  console.log("[cloak] Starting event logger...");
  const eventLogger = yield* Effect.forkChild(
    Stream.runForEach(session.events, (event) =>
      Effect.sync(() => console.log("[event]", event.method, event.params)),
    ),
  );

  console.log("[cloak] Navigating to https://vinted.fr...");
  yield* goto(cdp, sessionId, "https://vinted.fr");
  console.log("[cloak] Navigation complete");

  console.log("[cloak] Taking screenshot...");
  const { data } = yield* session.send(PageDomain.captureScreenshot, {});
  console.log("[cloak] Screenshot captured, base64 length:", data.length);

  const buffer = Buffer.from(data, "base64");
  yield* fs.writeFile("screenshot.png", buffer);
  console.log("[cloak] Screenshot saved to screenshot.png");

  yield* Fiber.interrupt(eventLogger);
  console.log("[cloak] Done");

  return data;
}).pipe(
  Effect.timeout(Duration.seconds(60)),
  Effect.tapError((error) =>
    Effect.sync(() => console.error("[cloak] Error:", error)),
  ),
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      console.error("[cloak] Failed:", cause);
      process.exit(1);
    }),
  ),
  Effect.provide(Cdp.layerBun(config)),
  Effect.provide(BunFileSystem.layer),
);

if (import.meta.main) {
  BunRuntime.runMain(program);
}
