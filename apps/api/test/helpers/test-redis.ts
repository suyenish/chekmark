import { GenericContainer, Wait } from 'testcontainers';

/** Same image as docker-compose.yml. */
export const REDIS_IMAGE = 'redis:8-alpine';

/** Starts a throwaway Redis for one test file. */
export async function startTestRedis(): Promise<{ url: string; stop: () => Promise<void> }> {
  const container = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
