import { describe, it, expect } from 'vitest';
import { hello } from './index';

describe('hello', () => {
  it('returns undefined', () => {
    expect(hello()).toBeUndefined();
  });
});
