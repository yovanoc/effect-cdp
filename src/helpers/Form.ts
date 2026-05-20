import { Effect, Schema } from "effect"

import type { Cdp } from "../Cdp.js"
import { CdpProtocolError } from "../errors.js"
import * as DOM from "../generated/DOM.js"
import * as Input from "../generated/Input.js"
import type { SessionId } from "../types.js"
import type { NodeId } from "./DOM.js"
import { evaluate } from "./Runtime.js"

interface KeyDescriptor {
  readonly key: string
  readonly code: string
  readonly windowsVirtualKeyCode: number
}

const KEY_MAP: Record<string, KeyDescriptor> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 }
}

const escapeForTemplate = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$")

/**
 * Type `text` into the currently focused element by dispatching `keyDown` and
 * `keyUp` events for each character.
 */
export const type = Effect.fnUntraced(function*(
  cdp: Cdp["Service"],
  sessionId: SessionId,
  text: string
) {
  const session = cdp.session(sessionId)

  for (const char of text) {
    yield* session.send(Input.dispatchKeyEvent, { type: "keyDown", text: char })
    yield* session.send(Input.dispatchKeyEvent, { type: "keyUp", text: char })
  }
})

/**
 * Focus the element identified by `nodeId` and set its `value` to the
 * provided string by evaluating an assignment in the page context.
 */
export const fill = Effect.fnUntraced(function*(
  cdp: Cdp["Service"],
  sessionId: SessionId,
  nodeId: NodeId,
  value: string
) {
  const session = cdp.session(sessionId)

  yield* session.send(DOM.focus, { nodeId })

  const expression = `(() => {
    const el = document.activeElement;
    if (el === null) return null;
    el.value = \`${escapeForTemplate(value)}\`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return null;
  })()`

  yield* evaluate(cdp, sessionId, expression, Schema.Null)
})

/**
 * Dispatch `keyDown` and `keyUp` events for a supported named key.
 *
 * Fails with `CdpProtocolError` if `key` is not in the supported keymap.
 */
export const press = Effect.fnUntraced(function*(
  cdp: Cdp["Service"],
  sessionId: SessionId,
  key: string
) {
  const descriptor = KEY_MAP[key]

  if (descriptor === undefined) {
    return yield* new CdpProtocolError({
      code: -1,
      message: `Unsupported key: ${key}`,
      method: "Input.dispatchKeyEvent"
    })
  }

  const session = cdp.session(sessionId)

  yield* session.send(Input.dispatchKeyEvent, {
    type: "keyDown",
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode
  })

  yield* session.send(Input.dispatchKeyEvent, {
    type: "keyUp",
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode
  })
})
