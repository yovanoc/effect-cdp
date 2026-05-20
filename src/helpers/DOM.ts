import { Effect, type Schema } from "effect";

import type { CdpService } from "../Cdp.js";
import { CdpProtocolError } from "../errors.js";
import * as DOM from "../generated/DOM.js";
import * as Input from "../generated/Input.js";
import type { SessionId } from "../types.js";
import { centroid } from "./internal/centroid.js";

export type NodeId = Schema.Schema.Type<typeof DOM.NodeId>;

/**
 * Query for the first element matching a CSS selector, starting from `nodeId`
 * (or the document root if `nodeId` is undefined).
 *
 * Fails with `CdpProtocolError` if no element matches.
 */
export const querySelector = Effect.fnUntraced(function* (
  cdp: CdpService,
  sessionId: SessionId,
  selector: string,
  nodeId?: NodeId,
) {
  const session = cdp.session(sessionId);

  yield* session.send(DOM.enable, {});

  const rootNodeId =
    nodeId ?? (yield* session.send(DOM.getDocument, {})).root.nodeId;

  const result = yield* session.send(DOM.querySelector, {
    nodeId: rootNodeId,
    selector,
  });

  if (result.nodeId === 0) {
    return yield* new CdpProtocolError({
      code: -1,
      message: `No element matches selector: ${selector}`,
      method: "DOM.querySelector",
    });
  }

  return result.nodeId;
});

/**
 * Click the center of the element identified by `nodeId`.
 *
 * Computes the centroid of the element's content quad and dispatches a
 * `mousePressed` followed by a `mouseReleased` event at that point.
 */
export const click = Effect.fnUntraced(function* (
  cdp: CdpService,
  sessionId: SessionId,
  nodeId: NodeId,
) {
  const session = cdp.session(sessionId);

  const { model } = yield* session.send(DOM.getBoxModel, { nodeId });
  const { x, y } = centroid(model.content);

  yield* session.send(Input.dispatchMouseEvent, {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });

  yield* session.send(Input.dispatchMouseEvent, {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
});
