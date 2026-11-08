import { GenericContainer, Wait } from 'testcontainers';

/** Same image and version as docker-compose.yml. */
export const SEAWEEDFS_IMAGE = 'chrislusf/seaweedfs:4.50';

/** Starts throwaway S3-compatible storage (SeaweedFS) for one test file. */
export async function startTestS3(): Promise<{ endpoint: string; stop: () => Promise<void> }> {
  const container = await new GenericContainer(SEAWEEDFS_IMAGE)
    .withCommand(['server', '-s3', '-dir=/data', '-ip.bind=0.0.0.0'])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp('/status', 8333).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8333)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
