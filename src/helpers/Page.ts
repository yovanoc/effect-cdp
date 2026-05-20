import { Effect, Fiber, Stream } from "effect"

import type { Cdp, CdpError } from "../Cdp.js"
import { CdpProtocolError } from "../errors.js"
import * as PageDomain from "../generated/Page.js"
import type { SessionId } from "../types.js"

export interface GotoOptions {
  readonly waitUntil?: "load" | "domcontentloaded"
}

export const goto = Effect.fnUntraced(function*(
  cdp: Cdp["Service"],
  sessionId: SessionId,
  url: string,
  opts?: GotoOptions
): Generator<Effect.Effect<unknown, CdpError>, void> {
  const session = cdp.session(sessionId)
  const waitUntil = opts?.waitUntil ?? "load"
  const expectedMethod = waitUntil === "domcontentloaded"
    ? PageDomain.domContentEventFired.method
    : PageDomain.loadEventFired.method

  yield* session.send(PageDomain.enable, {})

  const waitForLoad = session.events.pipe(
    Stream.filter((event) => event.method === expectedMethod),
    Stream.take(1),
    Stream.runDrain
  )

  const loadFiber = yield* Effect.forkChild(waitForLoad)

  const navigateResult = yield* session.send(PageDomain.navigate, { url })

  if (navigateResult.errorText !== undefined && navigateResult.errorText.length > 0) {
    yield* Fiber.interrupt(loadFiber)
    return yield* new CdpProtocolError({
      code: -1,
      message: navigateResult.errorText,
      method: PageDomain.navigate.method,
      sessionId
    })
  }

  yield* Fiber.await(loadFiber)
})
