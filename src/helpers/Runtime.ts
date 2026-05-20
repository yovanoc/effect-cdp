import { Cause, Effect, Exit, Schema } from "effect";

import type { Cdp, CdpError } from "../Cdp.js";
import { CdpDecodeError, CdpProtocolError } from "../errors.js";
import * as Runtime from "../generated/Runtime.js";
import type { SessionId } from "../types.js";

export interface EvaluateOptions {
  readonly returnByValue?: boolean;
}

const renderRaw = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
};

export const evaluate = Effect.fnUntraced(function* <A, I>(
  cdp: Cdp["Service"],
  sessionId: SessionId,
  expression: string,
  schema: Schema.Codec<A, I, never, never>,
  opts?: EvaluateOptions,
) {
  const response = yield* cdp.session(sessionId).send(Runtime.evaluate, {
    expression,
    returnByValue: opts?.returnByValue ?? true,
  });

  if (response.exceptionDetails !== undefined) {
    return yield* Effect.fail(
      new CdpProtocolError({
        code: -32000,
        message: response.exceptionDetails.text,
        method: "Runtime.evaluate",
      }),
    );
  }

  const decoded = Schema.decodeUnknownExit(schema)(response.result.value);
  return yield* Exit.match(decoded, {
    onSuccess: (value): Effect.Effect<A, CdpError> => Effect.succeed(value),
    onFailure: (cause): Effect.Effect<A, CdpError> =>
      Effect.fail(
        new CdpDecodeError({
          raw: renderRaw(response.result.value),
          parseError: Cause.pretty(cause),
        }),
      ),
  });
});
