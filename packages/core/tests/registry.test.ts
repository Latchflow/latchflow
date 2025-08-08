import { describe, it, expect } from 'vitest';
import registry, { PluginCapability } from '../src';

describe('PluginRegistry', () => {
  it('registers and retrieves capabilities', () => {
    const capability: PluginCapability = { kind: 'TRIGGER', key: 'dummy' };
    registry.register(capability);
    expect(registry.get('dummy')).toEqual(capability);
  });
});
