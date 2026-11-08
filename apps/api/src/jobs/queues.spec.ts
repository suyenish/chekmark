import { redisErrorWarner } from './queues.js';

describe('redisErrorWarner', () => {
  it('warns once a minute at most, naming the reason even when the message is empty', () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T12:00:00Z') });
    try {
      const warn = vi.fn();
      const onError = redisErrorWarner({ warn }, 'Redis is not reachable');
      const refused = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });

      onError(refused);
      onError(refused);
      vi.advanceTimersByTime(59_000);
      onError(refused);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Redis is not reachable: ECONNREFUSED');

      vi.advanceTimersByTime(2_000);
      onError(new Error('write EPIPE'));
      expect(warn).toHaveBeenLastCalledWith('Redis is not reachable: write EPIPE');
    } finally {
      vi.useRealTimers();
    }
  });
});
