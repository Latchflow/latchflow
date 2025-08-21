import type { BundleItem, FileItem, RecipientItem } from "@latchflow/testkit-api-types";

export interface DBSeed {
  files: FileItem[];
  bundles: BundleItem[];
  recipients: RecipientItem[];
  bundleObjects: { id: string; bundleId: string; fileId: string }[];
}

export class InMemoryStore {
  files = new Map<string, FileItem>();
  bundles = new Map<string, BundleItem>();
  recipients = new Map<string, RecipientItem>();
  bundleObjects = new Map<string, { id: string; bundleId: string; fileId: string }>();

  constructor(seed?: Partial<DBSeed>) {
    if (seed?.files) seed.files.forEach((f) => this.files.set(f.id, f));
    if (seed?.bundles) seed.bundles.forEach((b) => this.bundles.set(b.id, b));
    if (seed?.recipients) seed.recipients.forEach((r) => this.recipients.set(r.id, r));
    if (seed?.bundleObjects) seed.bundleObjects.forEach((o) => this.bundleObjects.set(o.id, o));
  }

  reset(seed?: Partial<DBSeed>) {
    this.files.clear();
    this.bundles.clear();
    this.recipients.clear();
    this.bundleObjects.clear();
    if (seed) {
      if (seed.files) seed.files.forEach((f) => this.files.set(f.id, f));
      if (seed.bundles) seed.bundles.forEach((b) => this.bundles.set(b.id, b));
      if (seed.recipients) seed.recipients.forEach((r) => this.recipients.set(r.id, r));
      if (seed.bundleObjects) seed.bundleObjects.forEach((o) => this.bundleObjects.set(o.id, o));
    }
  }
}
