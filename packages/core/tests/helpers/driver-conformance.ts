// StorageDriver conformance test helper (scaffold)
// Usage: import and invoke from a test file to generate a suite for a driver

import { describe, it, expect } from "vitest";

export type StorageDriver = any; // TODO: import type from core storage when available

export function storageDriverConformanceSuite(name: string, makeDriver: () => StorageDriver) {
  describe(`StorageDriver conformance: ${name}`, () => {
    it("can write and read a small object", async () => {
      const driver = makeDriver();
      expect(driver).toBeTruthy();
      // TODO: implement once driver interface is finalized
    });

    it("exposes ETag and preserves metadata", async () => {
      const driver = makeDriver();
      expect(driver).toBeTruthy();
      // TODO
    });
  });
}
