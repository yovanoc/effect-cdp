import { Schema } from "effect";

export const CdpConfig = Schema.Struct({
  webSocketDebuggerUrl: Schema.String,
  eventBufferSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(16)),
  defaultTimeout: Schema.optional(Schema.DurationFromMillis),
  reconnect: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      baseDelay: Schema.DurationFromMillis,
    }),
  ),
}).annotate({
  identifier: "CdpConfig",
});
