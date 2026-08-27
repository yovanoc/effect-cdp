import { Cause, Context, Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from "effect/unstable/http";

import type { CdpConfig } from "../CdpConfig.js";
import { CdpDecodeError } from "../errors.js";
import type { TargetId } from "../types.js";

export const CdpVersionInfo = Schema.Struct({
  Browser: Schema.String,
  "Protocol-Version": Schema.String,
  "User-Agent": Schema.String,
  "V8-Version": Schema.optional(Schema.String),
  "WebKit-Version": Schema.optional(Schema.String),
  webSocketDebuggerUrl: Schema.optional(Schema.String),
}).annotate({
  identifier: "CdpVersionInfo",
});

export type CdpVersionInfo = typeof CdpVersionInfo.Type;

export const CdpTargetInfo = Schema.Struct({
  description: Schema.String,
  devtoolsFrontendUrl: Schema.String,
  id: Schema.String,
  title: Schema.String,
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.optional(Schema.String),
}).annotate({
  identifier: "CdpTargetInfo",
});

export type CdpTargetInfo = typeof CdpTargetInfo.Type;

const CdpTargetInfoArray = Schema.Array(CdpTargetInfo).annotate({
  identifier: "CdpTargetInfoArray",
});

const deriveHttpBase = (webSocketDebuggerUrl: string): string => {
  const url = URL.parse(webSocketDebuggerUrl);
  if (url === null) {
    return webSocketDebuggerUrl;
  }
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  return `${protocol}//${url.host}`;
};

export class HttpDiscovery extends Context.Service<
  HttpDiscovery,
  {
    readonly version: Effect.Effect<CdpVersionInfo, CdpDecodeError>;
    readonly list: Effect.Effect<ReadonlyArray<CdpTargetInfo>, CdpDecodeError>;
    readonly newTab: (
      url?: string,
    ) => Effect.Effect<CdpTargetInfo, CdpDecodeError>;
    readonly close: (targetId: TargetId) => Effect.Effect<void, CdpDecodeError>;
  }
>()("effect-cdp/discovery/HttpDiscovery") {
  static readonly make = (
    config: typeof CdpConfig.Type,
  ): Effect.Effect<HttpDiscovery["Service"], never, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const baseUrl = deriveHttpBase(config.webSocketDebuggerUrl);

      const decodeBody = <S extends Schema.Top>(
        schema: S,
        response: HttpClientResponse.HttpClientResponse,
      ): Effect.Effect<S["Type"], CdpDecodeError, S["DecodingServices"]> =>
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.catchTags({
            SchemaError: (error) =>
              response.text.pipe(
                Effect.orElseSucceed(() => ""),
                Effect.flatMap(
                  (raw) =>
                    new CdpDecodeError({
                      raw,
                      parseError: Cause.pretty(Cause.fail(error)),
                    }),
                ),
              ),
            HttpClientError: Effect.die,
          }),
        );

      const version = Effect.fn("HttpDiscovery.version")(function* () {
        const response = yield* client
          .get(`${baseUrl}/json/version`)
          .pipe(Effect.catchTag("HttpClientError", Effect.die));
        return yield* decodeBody(CdpVersionInfo, response);
      });

      const list = Effect.fn("HttpDiscovery.list")(function* () {
        const response = yield* client
          .get(`${baseUrl}/json/list`)
          .pipe(Effect.catchTag("HttpClientError", Effect.die));
        return yield* decodeBody(CdpTargetInfoArray, response);
      });

      const newTab = Effect.fn("HttpDiscovery.newTab")(function* (
        url?: string,
      ) {
        const path =
          url === undefined
            ? `${baseUrl}/json/new`
            : `${baseUrl}/json/new?${encodeURIComponent(url)}`;
        const response = yield* client
          .put(path)
          .pipe(Effect.catchTag("HttpClientError", Effect.die));
        return yield* decodeBody(CdpTargetInfo, response);
      });

      const close = Effect.fn("HttpDiscovery.close")(function* (
        targetId: TargetId,
      ) {
        yield* client
          .get(`${baseUrl}/json/close/${targetId}`)
          .pipe(Effect.catchTag("HttpClientError", Effect.die));
      });

      return HttpDiscovery.of({
        version: version(),
        list: list(),
        newTab: (url?: string) => newTab(url),
        close: (targetId: TargetId) => close(targetId),
      });
    });

  static readonly layer = (
    config: typeof CdpConfig.Type,
  ): Layer.Layer<HttpDiscovery> =>
    Layer.effect(HttpDiscovery, HttpDiscovery.make(config)).pipe(
      Layer.provide(FetchHttpClient.layer),
    );
}
