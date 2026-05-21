import { GenericContainer } from "testcontainers";
import { Context, Effect, Layer } from "effect";

export interface CdpContainerShape {
  readonly host: string;
  readonly port: number;
}

export class CdpContainer extends Context.Service<
  CdpContainer,
  CdpContainerShape
>()("CdpContainer") {}

export const cdpUrl = (container: CdpContainerShape): string =>
  `ws://${container.host}:${container.port}/`;

export const TestContainerLive = Layer.effect(
  CdpContainer,
  Effect.acquireRelease(
    Effect.promise(async () => {
      const container = await new GenericContainer("browserless/chrome")
        .withExposedPorts(3000)
        .start();
      return {
        host: container.getHost(),
        port: container.getMappedPort(3000),
        _container: container,
      };
    }),
    (container) =>
      Effect.promise(async () => {
        await container._container.stop();
      }),
  ).pipe(Effect.map(({ host, port }) => ({ host, port }))),
);
