import { spawnSync } from "node:child_process";
import type { Schema } from "effect";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js";
import * as DOM from "../src/generated/DOM.js";
import * as Page from "../src/generated/Page.js";
import * as Runtime from "../src/generated/Runtime.js";

type Command = ProtocolMapping.Commands;
type CommandName = keyof Command;
type CommandEntry<Method extends CommandName> = Command[Method];
type Params<Method extends CommandName> =
  CommandEntry<Method>["paramsType"] extends readonly [infer Params]
    ? Params
    : void;
type Result<Method extends CommandName> = CommandEntry<Method>["returnType"];
type Encoded<SchemaType extends Schema.Top> = Schema.Codec.Encoded<SchemaType>;
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? [T] extends [unknown]
        ? true
        : false
      : false;
type OptionalKeys<T extends object> = {
  [Key in keyof T]-?: {} extends Pick<T, Key> ? Key : never;
}[keyof T];
type RequiredKeys<T extends object> = Exclude<keyof T, OptionalKeys<T>>;
type ProtocolShape<T> =
  IsAny<T> extends true
    ? T
    : [T] extends [void]
      ? void
      : T extends ReadonlyArray<infer Item>
        ? ReadonlyArray<ProtocolShape<Item>>
        : T extends object
          ? {
              readonly [Key in RequiredKeys<T>]: ProtocolShape<T[Key]>;
            } & {
              readonly [Key in OptionalKeys<T>]?:
                | ProtocolShape<Exclude<T[Key], undefined>>
                | undefined;
            }
          : T;
type ActualShape<Expected, Actual> =
  IsUnknown<Actual> extends true
    ? ProtocolShape<Expected>
    : undefined extends Actual
      ?
          | ActualShape<
              Exclude<Expected, undefined>,
              Exclude<Actual, undefined>
            >
          | undefined
      : Expected extends ReadonlyArray<infer ExpectedItem>
        ? Actual extends ReadonlyArray<infer ActualItem>
          ? ReadonlyArray<ActualShape<ExpectedItem, ActualItem>>
          : Actual
        : Expected extends object
          ? Actual extends object
            ? {
                readonly [Key in keyof Actual]: Key extends keyof Expected
                  ? ActualShape<Expected[Key], Actual[Key]>
                  : Actual[Key];
              }
            : Actual
          : Actual;
type Mismatch<Method extends CommandName> = `MISMATCH ${Method}`;
type AssertMatches<Expected, Actual, Method extends CommandName> = [
  ActualShape<Expected, Actual>,
] extends [ProtocolShape<Expected>]
  ? true
  : Mismatch<Method>;

export const runtimeEvaluateParams: AssertMatches<
  Params<"Runtime.evaluate">,
  Encoded<typeof Runtime.evaluate.params>,
  "Runtime.evaluate"
> = true;
export const runtimeEvaluateResult: AssertMatches<
  Result<"Runtime.evaluate">,
  Encoded<typeof Runtime.evaluate.result>,
  "Runtime.evaluate"
> = true;

export const domQuerySelectorParams: AssertMatches<
  Params<"DOM.querySelector">,
  Encoded<typeof DOM.querySelector.params>,
  "DOM.querySelector"
> = true;
export const domQuerySelectorResult: AssertMatches<
  Result<"DOM.querySelector">,
  Encoded<typeof DOM.querySelector.result>,
  "DOM.querySelector"
> = true;

export const pageNavigateParams: AssertMatches<
  Params<"Page.navigate">,
  Encoded<typeof Page.navigate.params>,
  "Page.navigate"
> = true;
export const pageNavigateResult: AssertMatches<
  Result<"Page.navigate">,
  Encoded<typeof Page.navigate.result>,
  "Page.navigate"
> = true;

const check = spawnSync("bun", ["run", "ts:check"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "pipe",
});

const output = `${check.stdout}${check.stderr}`;
const mismatches = new Set(
  output.match(/MISMATCH [A-Za-z]+\.[A-Za-z]+/g) ?? [],
);

if (mismatches.size > 0) {
  for (const mismatch of mismatches) {
    console.error(mismatch);
  }
  process.exit(1);
}

if (check.status !== 0) {
  process.stderr.write(output);
  process.exit(check.status ?? 1);
}

console.log("codegen check OK");
