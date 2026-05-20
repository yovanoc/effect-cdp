#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Fiber,
  Metric,
  Ref,
  Schema,
  Stream,
} from "effect";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cdp } from "../src/Cdp.js";
import type { CdpConfig } from "../src/CdpConfig.js";
import { HttpDiscovery } from "../src/discovery/HttpDiscovery.js";
import { CdpDisconnected } from "../src/errors.js";
import * as GeneratedRuntime from "../src/generated/Runtime.js";
import * as GeneratedTarget from "../src/generated/Target.js";
import * as DOM from "../src/helpers/DOM.js";
import * as Page from "../src/helpers/Page.js";
import * as Runtime from "../src/helpers/Runtime.js";
import * as Target from "../src/helpers/Target.js";
import { TargetId } from "../src/types.js";

const DEFAULT_DEVTOOLS_HOST = "http://127.0.0.1:9222";

const BUTTON_HTML =
  "data:text/html,<html><head><title>smoke</title></head><body>" +
  '<button id="btn" onclick="document.title=\'clicked\'">click</button>' +
  "</body></html>";

const parseFlags = (
  argv: ReadonlyArray<string>,
): {
  readonly test: string;
  readonly host: string;
  readonly chromiumPath: string | undefined;
} => {
  let test = "default";
  let host = DEFAULT_DEVTOOLS_HOST;
  let chromiumPath: string | undefined = undefined;
  for (const arg of argv) {
    if (arg.startsWith("--test-")) {
      test = arg.slice("--test-".length);
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg.startsWith("--chromium-path=")) {
      chromiumPath = arg.slice("--chromium-path=".length);
    }
  }
  return { test, host, chromiumPath };
};

class NoTargetsError extends Schema.TaggedErrorClass<NoTargetsError>(
  "NoTargetsError",
)("NoTargetsError", { message: Schema.String }) {}

class MissingWebSocketUrlError extends Schema.TaggedErrorClass<MissingWebSocketUrlError>(
  "MissingWebSocketUrlError",
)("MissingWebSocketUrlError", { message: Schema.String }) {}

class AssertionError extends Schema.TaggedErrorClass<AssertionError>(
  "AssertionError",
)("AssertionError", { message: Schema.String }) {}

class ChromiumNotFoundError extends Schema.TaggedErrorClass<ChromiumNotFoundError>(
  "ChromiumNotFoundError",
)("ChromiumNotFoundError", { message: Schema.String }) {}

class ChromiumLaunchTimeoutError extends Schema.TaggedErrorClass<ChromiumLaunchTimeoutError>(
  "ChromiumLaunchTimeoutError",
)("ChromiumLaunchTimeoutError", { message: Schema.String }) {}

const discoverConfig = Effect.fnUntraced(function* (host: string) {
  const bootstrap = HttpDiscovery.layer({
    webSocketDebuggerUrl: host.replace(/^http/, "ws") + "/devtools/browser",
    eventBufferSize: 64,
  });
  const result = yield* Effect.gen(function* () {
    const discovery = yield* HttpDiscovery;
    yield* discovery.version();
    const targets = yield* discovery.list();
    const pageTarget = targets.find((t) => t.type === "page");
    if (pageTarget === undefined) {
      return yield* new NoTargetsError({ message: "no page targets found" });
    }
    if (pageTarget.webSocketDebuggerUrl === undefined) {
      return yield* new MissingWebSocketUrlError({
        message: `target ${pageTarget.id} missing webSocketDebuggerUrl`,
      });
    }
    const config: typeof CdpConfig.Type = {
      webSocketDebuggerUrl: pageTarget.webSocketDebuggerUrl,
      eventBufferSize: 64,
    };
    return { config, targetId: pageTarget.id };
  }).pipe(Effect.provide(bootstrap));
  return result;
});

const runDefault = Effect.fnUntraced(function* (targetId: string) {
  const cdp = yield* Cdp;

  const sessionId = yield* Target.attach(cdp, targetId);

  const sum = yield* Runtime.evaluate(cdp, sessionId, "1+1", Schema.Number);
  if (sum !== 2) {
    return yield* new AssertionError({
      message: `expected 1+1 === 2, got ${sum}`,
    });
  }
  yield* Effect.log("OK 1+1=2");

  yield* Page.goto(cdp, sessionId, BUTTON_HTML);
  const nodeId = yield* DOM.querySelector(cdp, sessionId, "#btn");
  yield* DOM.click(cdp, sessionId, nodeId);

  const title = yield* Runtime.evaluate(
    cdp,
    sessionId,
    "document.title",
    Schema.String,
  );
  if (title !== "clicked") {
    return yield* new AssertionError({
      message: `expected document.title === 'clicked', got '${title}'`,
    });
  }
  yield* Effect.log("OK click registered");
});

const runDetach = Effect.fnUntraced(function* (targetId: string) {
  const cdp = yield* Cdp;

  const parentSessionId = yield* Target.attach(cdp, targetId);

  const childTarget = yield* cdp
    .session(parentSessionId)
    .send(GeneratedTarget.createTarget, {
      url: "about:blank",
    });

  const childSessionId = yield* Target.attach(cdp, childTarget.targetId);

  const pendingFiber = yield* Effect.forkChild(
    cdp.session(childSessionId).send(GeneratedRuntime.evaluate, {
      expression: "new Promise(() => {})",
      awaitPromise: true,
      returnByValue: true,
    }),
  );

  yield* cdp.session(parentSessionId).send(GeneratedTarget.detachFromTarget, {
    sessionId: childSessionId,
  });

  const exit = yield* Fiber.join(pendingFiber).pipe(
    Effect.timeout("500 millis"),
    Effect.exit,
  );

  if (!Exit.isFailure(exit)) {
    return yield* new AssertionError({
      message:
        "expected child-session send to fail after detach, but it succeeded",
    });
  }

  const failureOption = Cause.findErrorOption(exit.cause);
  if (failureOption._tag === "None") {
    return yield* new AssertionError({
      message: `expected typed CdpDisconnected failure, got cause: ${Cause.pretty(exit.cause)}`,
    });
  }
  const error = failureOption.value;
  if (
    !(error instanceof CdpDisconnected) ||
    error.reason !== "TargetDetached"
  ) {
    return yield* new AssertionError({
      message: `expected CdpDisconnected{reason:'TargetDetached'}, got: ${Cause.pretty(exit.cause)}`,
    });
  }
  yield* Effect.log(
    "OK child session failed with CdpDisconnected{reason:'TargetDetached'}",
  );

  const one = yield* Runtime.evaluate(cdp, parentSessionId, "1", Schema.Number);
  if (one !== 1) {
    return yield* new AssertionError({
      message: `expected parent Runtime.evaluate('1') === 1, got ${one}`,
    });
  }
  yield* Effect.log("OK parent session still works after child detach");
});

const runTimeout = Effect.fnUntraced(function* (targetId: string) {
  const cdp = yield* Cdp;
  const sessionId = yield* Target.attach(cdp, targetId);

  const start = Date.now();
  const outcome = yield* cdp
    .session(sessionId)
    .send(
      GeneratedRuntime.evaluate,
      {
        expression: "new Promise(() => {})",
        awaitPromise: true,
        returnByValue: true,
      },
      { timeout: Duration.millis(200) },
    )
    .pipe(
      Effect.map(() => "resolved" as const),
      Effect.catchTag("CdpTimeout", (err) =>
        Effect.gen(function* () {
          yield* Effect.log(`CdpTimeout durationMs=${err.durationMs}`);
          if (err.durationMs < 200) {
            return yield* new AssertionError({
              message: `expected durationMs >= 200, got ${err.durationMs}`,
            });
          }
          return "timed-out" as const;
        }),
      ),
    );
  const elapsed = Date.now() - start;
  if (outcome !== "timed-out") {
    return yield* new AssertionError({
      message: `expected CdpTimeout, got ${outcome}`,
    });
  }
  if (elapsed > 500) {
    return yield* new AssertionError({
      message: `timeout took too long: ${elapsed}ms`,
    });
  }

  const sizeEffect = cdp.__testPendingSize;
  if (sizeEffect === undefined) {
    return yield* new AssertionError({
      message: "__testPendingSize hook not exposed; ensure EFFECT_CDP_TEST=1",
    });
  }
  const pending = yield* sizeEffect;
  yield* Effect.log(`pending=${pending}`);
  if (pending !== 0) {
    return yield* new AssertionError({
      message: `expected pending=0 after timeout, got ${pending}`,
    });
  }
});

const runBackpressure = Effect.fnUntraced(function* (targetId: string) {
  const cdp = yield* Cdp;
  const sessionId = yield* Target.attach(cdp, targetId);

  yield* cdp.session(sessionId).send(GeneratedRuntime.enable, {});

  const droppedCounter = Metric.counter("cdp_events_dropped_total");
  const before = yield* Metric.value(droppedCounter);
  yield* Effect.log(`baseline cdp_events_dropped_total=${before.count}`);

  const received = yield* Ref.make(0);
  const consumerFiber = yield* Effect.forkChild(
    cdp.session(sessionId).events.pipe(
      Stream.filter((event) => event.method === "Runtime.consoleAPICalled"),
      Stream.runForEach(() =>
        Effect.sleep("50 millis").pipe(
          Effect.andThen(Ref.update(received, (n) => n + 1)),
        ),
      ),
    ),
  );

  // Give the subscriber a moment to attach to the PubSub before flooding.
  yield* Effect.sleep("100 millis");

  const floodCount = 500;
  yield* Effect.log(`flooding ${floodCount} console.log calls`);
  yield* cdp.session(sessionId).send(GeneratedRuntime.evaluate, {
    expression: `for (let i = 0; i < ${floodCount}; i++) { console.log('flood', i); }`,
    returnByValue: true,
  });

  // Allow events to flow and the dropping PubSub to register overflows.
  yield* Effect.sleep("1 seconds");

  const after = yield* Metric.value(droppedCounter);
  const delta = after.count - before.count;
  const receivedCount = yield* Ref.get(received);
  yield* Effect.log(
    `cdp_events_dropped_total=${after.count} delta=${delta} consumerReceived=${receivedCount}`,
  );

  yield* Fiber.interrupt(consumerFiber);

  if (delta <= 0) {
    return yield* new AssertionError({
      message: `expected cdp_events_dropped_total to increment, got delta=${delta} (before=${before.count} after=${after.count}, consumerReceived=${receivedCount})`,
    });
  }
  yield* Effect.log(`OK backpressure dropped ${delta} event(s)`);
});

const runMultiSession = Effect.fnUntraced(function* (targetId: string) {
  const cdp = yield* Cdp;

  // sessionA: attach to the page target discovered by discoverConfig
  const sessionA = yield* Target.attach(cdp, targetId);

  // sessionB: create a second blank page target and attach to it
  const created = yield* cdp
    .session(sessionA)
    .send(GeneratedTarget.createTarget, {
      url: "about:blank",
    });
  const sessionB = yield* Target.attach(cdp, created.targetId);

  if (sessionA === sessionB) {
    return yield* new AssertionError({
      message: `expected distinct sessions, got sessionA === sessionB === ${sessionA}`,
    });
  }
  yield* Effect.log(
    `OK distinct sessions sessionA=${sessionA} sessionB=${sessionB}`,
  );

  // Enable Runtime on both sessions so consoleAPICalled is emitted for either.
  yield* cdp.session(sessionA).send(GeneratedRuntime.enable, {});
  yield* cdp.session(sessionB).send(GeneratedRuntime.enable, {});

  const marker = `session-a-marker-${Date.now()}`;

  const receivedA = yield* Ref.make(0);
  const receivedB = yield* Ref.make(0);

  const containsMarker = (event: { readonly params: unknown }): boolean => {
    const params = event.params;
    if (params === null || typeof params !== "object") return false;
    const args = (
      params as { readonly args?: ReadonlyArray<{ readonly value?: unknown }> }
    ).args;
    if (!Array.isArray(args)) return false;
    for (const arg of args) {
      if (
        arg !== null &&
        typeof arg === "object" &&
        "value" in arg &&
        (arg as { value?: unknown }).value === marker
      ) {
        return true;
      }
    }
    return false;
  };

  const fiberA = yield* Effect.forkChild(
    cdp.session(sessionA).events.pipe(
      Stream.filter((event) => event.method === "Runtime.consoleAPICalled"),
      Stream.filter(containsMarker),
      Stream.runForEach(() => Ref.update(receivedA, (n) => n + 1)),
    ),
  );
  const fiberB = yield* Effect.forkChild(
    cdp.session(sessionB).events.pipe(
      Stream.filter((event) => event.method === "Runtime.consoleAPICalled"),
      Stream.filter(containsMarker),
      Stream.runForEach(() => Ref.update(receivedB, (n) => n + 1)),
    ),
  );

  // Let subscribers attach to the PubSub before firing.
  yield* Effect.sleep("100 millis");

  // Fire console.log on sessionA only.
  yield* cdp.session(sessionA).send(GeneratedRuntime.evaluate, {
    expression: `console.log(${JSON.stringify(marker)})`,
    returnByValue: true,
  });

  // Wait briefly for events to propagate.
  yield* Effect.sleep("200 millis");

  yield* Fiber.interrupt(fiberA);
  yield* Fiber.interrupt(fiberB);

  const countA = yield* Ref.get(receivedA);
  const countB = yield* Ref.get(receivedB);
  yield* Effect.log(
    `sessionA marker events=${countA} sessionB marker events=${countB}`,
  );

  if (countB !== 0) {
    return yield* new AssertionError({
      message: `cross-session leak: sessionB received ${countB} event(s) with marker '${marker}' fired on sessionA`,
    });
  }
  if (countA < 1) {
    return yield* new AssertionError({
      message: `expected sessionA to receive >=1 marker event, got ${countA}`,
    });
  }
  yield* Effect.log(
    `OK multi-session isolation: sessionA=${countA} sessionB=${countB}`,
  );
});

const runDiscovery = Effect.fnUntraced(function* (host: string) {
  const wsUrl = host.replace(/^http/, "ws") + "/devtools/browser";
  const bootstrap = HttpDiscovery.layer({
    webSocketDebuggerUrl: wsUrl,
    eventBufferSize: 64,
  });

  yield* Effect.gen(function* () {
    const discovery = yield* HttpDiscovery;

    const version = yield* discovery.version();
    if (typeof version.Browser !== "string" || version.Browser.length === 0) {
      return yield* new AssertionError({
        message: `version.Browser missing or empty, got ${JSON.stringify(version.Browser)}`,
      });
    }
    if (
      typeof version["Protocol-Version"] !== "string" ||
      version["Protocol-Version"].length === 0
    ) {
      return yield* new AssertionError({
        message: `version.Protocol-Version missing or empty, got ${JSON.stringify(version["Protocol-Version"])}`,
      });
    }
    if (
      typeof version.webSocketDebuggerUrl !== "string" ||
      version.webSocketDebuggerUrl.length === 0
    ) {
      return yield* new AssertionError({
        message: `version.webSocketDebuggerUrl missing or empty, got ${JSON.stringify(version.webSocketDebuggerUrl)}`,
      });
    }
    yield* Effect.log(
      `OK version Browser=${version.Browser} Protocol-Version=${version["Protocol-Version"]}`,
    );

    const targets = yield* discovery.list();
    if (targets.length < 1) {
      return yield* new AssertionError({
        message: `expected list() length >= 1, got ${targets.length}`,
      });
    }
    const first = targets[0];
    if (first === undefined) {
      return yield* new AssertionError({ message: "list()[0] undefined" });
    }
    if (typeof first.id !== "string" || first.id.length === 0) {
      return yield* new AssertionError({
        message: `list()[0].id missing or empty, got ${JSON.stringify(first.id)}`,
      });
    }
    if (typeof first.type !== "string" || first.type.length === 0) {
      return yield* new AssertionError({
        message: `list()[0].type missing or empty, got ${JSON.stringify(first.type)}`,
      });
    }
    if (
      typeof first.webSocketDebuggerUrl !== "string" ||
      first.webSocketDebuggerUrl.length === 0
    ) {
      return yield* new AssertionError({
        message: `list()[0].webSocketDebuggerUrl missing or empty, got ${JSON.stringify(first.webSocketDebuggerUrl)}`,
      });
    }
    yield* Effect.log(
      `OK list returned ${targets.length} target(s), first id=${first.id} type=${first.type}`,
    );

    const created = yield* discovery.newTab("about:blank");
    if (typeof created.id !== "string" || created.id.length === 0) {
      return yield* new AssertionError({
        message: `newTab().id missing or empty, got ${JSON.stringify(created.id)}`,
      });
    }
    const newTargetId = TargetId.makeUnsafe(created.id);
    yield* Effect.log(`OK newTab created targetId=${newTargetId}`);

    yield* discovery.close(newTargetId);
    yield* Effect.log(`OK close targetId=${newTargetId}`);
  }).pipe(Effect.provide(bootstrap));
});

const findChromium = (
  override: string | undefined,
): Effect.Effect<string, ChromiumNotFoundError> =>
  Effect.sync(() => {
    if (override !== undefined && override.length > 0) return override;
    for (const cmd of ["chromium", "google-chrome", "chrome"]) {
      try {
        const found = execSync(`which ${cmd}`, {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
        if (found.length > 0) return found;
      } catch {
        // try next
      }
    }
    return null;
  }).pipe(
    Effect.flatMap((p) =>
      p === null
        ? new ChromiumNotFoundError({
            message:
              "could not locate chromium/google-chrome on PATH; pass --chromium-path=",
          })
        : Effect.succeed(p),
    ),
  );

const waitForChromium = (
  host: string,
): Effect.Effect<void, ChromiumLaunchTimeoutError> => {
  const ping = Effect.tryPromise({
    try: () => fetch(`${host}/json/version`).then((r) => r.ok),
    catch: () => false as const,
  }).pipe(Effect.catch(() => Effect.succeed(false as boolean)));
  return Effect.gen(function* () {
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const ok = yield* ping;
      if (ok) return;
      yield* Effect.sleep("100 millis");
    }
    return yield* new ChromiumLaunchTimeoutError({
      message: `chromium did not become ready at ${host} within 10s`,
    });
  });
};

const runDisconnect = Effect.fnUntraced(function* (
  chromiumPath: string | undefined,
) {
  const binary = yield* findChromium(chromiumPath);
  const port = 9333;
  const host = `http://127.0.0.1:${port}`;
  const userDataDir = mkdtempSync(join(tmpdir(), "effect-cdp-smoke-"));

  const proc = yield* Effect.acquireRelease(
    Effect.sync(() =>
      spawn(
        binary,
        [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${userDataDir}`,
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "about:blank",
        ],
        { stdio: "ignore", detached: false },
      ),
    ),
    (p) =>
      Effect.sync(() => {
        if (!p.killed && p.exitCode === null) {
          try {
            p.kill("SIGKILL");
          } catch {
            // already dead
          }
        }
      }),
  );

  yield* waitForChromium(host);
  yield* Effect.log(`OK chromium ready pid=${proc.pid} port=${port}`);

  const { config, targetId } = yield* discoverConfig(host);

  const work = Effect.gen(function* () {
    const cdp = yield* Cdp;
    const sessionId = yield* Target.attach(cdp, targetId);

    const killAt = yield* Effect.forkChild(
      Effect.sleep("500 millis").pipe(
        Effect.andThen(
          Effect.sync(() => {
            const ts = Date.now();
            try {
              proc.kill("SIGKILL");
            } catch {
              // already dead
            }
            return ts;
          }),
        ),
      ),
    );

    const start = Date.now();
    const exit = yield* cdp
      .session(sessionId)
      .send(GeneratedRuntime.evaluate, {
        expression: "new Promise(() => {})",
        awaitPromise: true,
        returnByValue: true,
      })
      .pipe(Effect.exit);
    const failedAt = Date.now();

    const killTs = yield* Fiber.join(killAt);
    const elapsed = failedAt - killTs;

    if (!Exit.isFailure(exit)) {
      return yield* new AssertionError({
        message:
          "expected Runtime.evaluate to fail after SIGKILL, but it succeeded",
      });
    }
    const failureOption = Cause.findErrorOption(exit.cause);
    if (failureOption._tag === "None") {
      return yield* new AssertionError({
        message: `expected typed CdpDisconnected failure, got cause: ${Cause.pretty(exit.cause)}`,
      });
    }
    const error = failureOption.value;
    if (
      !(error instanceof CdpDisconnected) ||
      error.reason !== "SocketClosed"
    ) {
      return yield* new AssertionError({
        message: `expected CdpDisconnected{reason:'SocketClosed'}, got: ${Cause.pretty(exit.cause)}`,
      });
    }
    if (elapsed > 2000) {
      return yield* new AssertionError({
        message: `expected failure within 2000ms of SIGKILL, got ${elapsed}ms`,
      });
    }
    yield* Effect.log(
      `OK CdpDisconnected reason=SocketClosed elapsed=${elapsed}ms (sendStart→fail=${failedAt - start}ms)`,
    );
  });

  yield* work.pipe(Effect.provide(Cdp.layerBun(config)), Effect.scoped);
});

const program = Effect.fnUntraced(function* () {
  const { host, test } = parseFlags(process.argv.slice(2));

  if (test === "discovery") {
    yield* runDiscovery(host);
    return;
  }

  if (test === "disconnect") {
    const { chromiumPath } = parseFlags(process.argv.slice(2));
    yield* runDisconnect(chromiumPath).pipe(Effect.scoped);
    return;
  }

  const { config, targetId } = yield* discoverConfig(host);

  switch (test) {
    case "default":
      yield* runDefault(targetId).pipe(
        Effect.provide(Cdp.layerBun(config)),
        Effect.scoped,
      );
      return;
    case "detach":
      yield* runDetach(targetId).pipe(
        Effect.provide(Cdp.layerBun(config)),
        Effect.scoped,
      );
      return;
    case "timeout":
      yield* runTimeout(targetId).pipe(
        Effect.provide(Cdp.layerBun(config)),
        Effect.scoped,
      );
      return;
    case "backpressure":
      yield* runBackpressure(targetId).pipe(
        Effect.provide(Cdp.layerBun(config)),
        Effect.scoped,
      );
      return;
    case "multi-session":
      yield* runMultiSession(targetId).pipe(
        Effect.provide(Cdp.layerBun(config)),
        Effect.scoped,
      );
      return;
    default:
      yield* Effect.log(`sub-test '${test}' not implemented in base smoke`);
      return;
  }
});

const main = program().pipe(
  Effect.catch((error) =>
    Effect.logError(`smoke failed: ${Cause.pretty(Cause.fail(error))}`).pipe(
      Effect.andThen(Effect.die(error)),
    ),
  ),
);

BunRuntime.runMain(main);
