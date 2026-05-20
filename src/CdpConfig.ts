import { Schema } from "effect";

export const CdpConfig = Schema.Struct({
  webSocketDebuggerUrl: Schema.String,
  eventBufferSize: Schema.Number.check(Schema.isInt()).check(
    Schema.isGreaterThanOrEqualTo(16),
  ),
  defaultTimeout: Schema.optional(Schema.DurationFromMillis),
}).annotate({
  identifier: "CdpConfig",
});
