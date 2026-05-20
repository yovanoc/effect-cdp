import { Schema } from "effect"

import { CdpRequestId, SessionId } from "./types.js"

export class CdpDisconnected extends Schema.TaggedErrorClass<CdpDisconnected>("CdpDisconnected")(
  "CdpDisconnected",
  {
    reason: Schema.Literals(["SocketClosed", "ScopeFinalized", "TargetDetached", "PeerKilled"])
  }
) {}

export class CdpTimeout extends Schema.TaggedErrorClass<CdpTimeout>("CdpTimeout")(
  "CdpTimeout",
  {
    method: Schema.String,
    requestId: CdpRequestId,
    durationMs: Schema.Number
  }
) {}

export class CdpDecodeError extends Schema.TaggedErrorClass<CdpDecodeError>("CdpDecodeError")(
  "CdpDecodeError",
  {
    raw: Schema.String,
    parseError: Schema.String
  }
) {}

export class CdpProtocolError extends Schema.TaggedErrorClass<CdpProtocolError>("CdpProtocolError")(
  "CdpProtocolError",
  {
    code: Schema.Number,
    message: Schema.String,
    method: Schema.String,
    sessionId: Schema.optional(SessionId)
  }
) {}
