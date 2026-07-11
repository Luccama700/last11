import { describe, expect, it } from 'vitest';

describe('harness smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
