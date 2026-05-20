# Decisions

## [2026-05-20T08:34] Architecture Decisions (from planning phase)

- Custom dispatcher (NOT @effect/rpc) — ADR-001 will document rationale
- Socket bridge: Queue.unbounded + Socket.run + Stream.fromQueue (NOT Socket.toChannel)
- PubSub.dropping(N) + Metric.counter("cdp_events_dropped_total") + rate-limited logWarning
- Scope finalizer LIFO: register socket-close FIRST (runs LAST), drain pending SECOND (runs FIRST)
- CdpRequestId = number & Brand (NOT bigint) — JSON wire format
- Domain Schema → CdpSchema.ts rename (already in plan)
- Only 4 typed errors: CdpDisconnected, CdpTimeout, CdpDecodeError, CdpProtocolError
- G34: Typed send API — accepts Command bundle {method, params, result} from generated domain files
