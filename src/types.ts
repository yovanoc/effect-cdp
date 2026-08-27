import { Schema } from "effect";

const CdpRequestIdSchema = Schema.Int.pipe(
  Schema.brand("CdpRequestId"),
).annotate({
  identifier: "CdpRequestId",
});

const SessionIdSchema = Schema.String.pipe(Schema.brand("SessionId")).annotate({
  identifier: "SessionId",
});

const TargetIdSchema = Schema.String.pipe(Schema.brand("TargetId")).annotate({
  identifier: "TargetId",
});

const FrameIdSchema = Schema.String.pipe(Schema.brand("FrameId")).annotate({
  identifier: "FrameId",
});

export const CdpRequestId = Object.assign(CdpRequestIdSchema, {
  makeUnsafe: (value: number) => CdpRequestIdSchema.make(value),
});

export const SessionId = Object.assign(SessionIdSchema, {
  makeUnsafe: (value: string) => SessionIdSchema.make(value),
});

export const TargetId = Object.assign(TargetIdSchema, {
  makeUnsafe: (value: string) => TargetIdSchema.make(value),
});

export const FrameId = Object.assign(FrameIdSchema, {
  makeUnsafe: (value: string) => FrameIdSchema.make(value),
});

export type CdpRequestId = typeof CdpRequestIdSchema.Type;
export type SessionId = typeof SessionIdSchema.Type;
export type TargetId = typeof TargetIdSchema.Type;
export type FrameId = typeof FrameIdSchema.Type;
