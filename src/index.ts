import { BunRuntime } from '@effect/platform-bun';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';
import { Effect } from 'effect';

const program = Effect.logInfo("Hello, Effect CDP!");

if (import.meta.main) {
  BunRuntime.runMain(program);
}
