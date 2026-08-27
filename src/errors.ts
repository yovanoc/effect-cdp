import { Schema } from "effect";

import { CdpRequestId, SessionId } from "./types.js";

export class CdpDisconnected extends Schema.TaggedError<CdpDisconnected>()(
  "CdpDisconnected",
  {
    reason: Schema.Literals([
      "SocketClosed",
      "ScopeFinalized",
      "TargetDetached",
      "PeerKilled",
    ]),
  },
) {}

export class CdpTimeout extends Schema.TaggedError<CdpTimeout>()("CdpTimeout", {
  method: Schema.String,
  requestId: CdpRequestId,
  durationMs: Schema.Finite,
}) {}

export class CdpDecodeError extends Schema.TaggedError<CdpDecodeError>()(
  "CdpDecodeError",
  {
    raw: Schema.String,
    parseError: Schema.String,
  },
) {}

export class CdpProtocolError extends Schema.TaggedError<CdpProtocolError>()(
  "CdpProtocolError",
  {
    code: Schema.Int,
    message: Schema.String,
    method: Schema.String,
    sessionId: Schema.optional(SessionId),
  },
) {}
