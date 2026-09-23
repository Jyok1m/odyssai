import { describe, expect, it } from 'vitest';
import { makeConfig } from '../auth/testing/doubles.js';

describe('AppConfig', () => {
  it('prefixe les cles BullMQ avec bull par defaut, et refuse ce qui casserait les cles', () => {
    expect(makeConfig().queuePrefix).toBe('bull');
    expect(makeConfig({ BULLMQ_PREFIX: 'bull-local' }).queuePrefix).toBe('bull-local');
    expect(() => makeConfig({ BULLMQ_PREFIX: 'bull:local' })).toThrow(/BULLMQ_PREFIX/);
  });
});
