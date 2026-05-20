import { Duration, Effect, Schema, Stream } from "effect"

import type { Cdp } from "../Cdp.js"
import { CdpDecodeError, CdpTimeout } from "../errors.js"
import * as Network from "../generated/Network.js"
import { CdpRequestId, type SessionId } from "../types.js"

export type NetworkResponse = typeof Network.Response.Type

export interface WaitForResponseOptions {
  readonly timeout?: Duration.Duration
}

const renderRaw = (value: unknown): string => {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? String(value) : encoded
}

const decodeParams = Schema.decodeUnknownEffect(Network.responseReceived.params)

const matchesUrl = (urlPattern: string | RegExp, url: string): boolean =>
  typeof urlPattern === "string" ? url === urlPattern : urlPattern.test(url)

/**
 * Wait for the first `Network.responseReceived` event whose URL matches
 * `urlPattern`. String patterns match by equality; RegExp patterns by `.test`.
 *
 * Enables the `Network` domain on the session and passively observes events.
 * No requests are intercepted or modified.
 *
 * Fails with `CdpTimeout` if `opts.timeout` elapses before a match.
 */
export const waitForResponse = Effect.fnUntraced(function*(
  cdp: Cdp["Service"],
  sessionId: SessionId,
  urlPattern: string | RegExp,
  opts?: WaitForResponseOptions
) {
  const session = cdp.session(sessionId)

  yield* session.send(Network.enable, {})

  const program = session.events.pipe(
    Stream.filter((event) => event.method === Network.responseReceived.method),
    Stream.mapEffect((event) =>
      decodeParams(event.params).pipe(
        Effect.mapError((error) =>
          new CdpDecodeError({
            raw: renderRaw(event.params),
            parseError: String(error)
          })
        )
      )
    ),
    Stream.filter((params) => matchesUrl(urlPattern, params.response.url)),
    Stream.take(1),
    Stream.runHead,
    Effect.flatMap((option) =>
      option._tag === "Some"
        ? Effect.succeed(option.value.response)
        : Effect.die("Network.waitForResponse: stream ended without a matching response")
    )
  )

  if (opts?.timeout !== undefined) {
    const timeout = opts.timeout
    return yield* program.pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new CdpTimeout({
              method: "Network.waitForResponse",
              requestId: CdpRequestId.makeUnsafe(0),
              durationMs: Duration.toMillis(timeout)
            })
          )
      })
    )
  }

  return yield* program
})
