import { BundleItem, FileItem, RecipientItem } from "@latchflow/testkit-api-types";

const iso = () => new Date().toISOString();
const uuid = () => "id-" + Math.random().toString(36).slice(2, 10);

export function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: overrides.id ?? uuid(),
    name: overrides.name ?? "file.bin",
    size: overrides.size ?? 123,
    contentType: overrides.contentType ?? "application/octet-stream",
    createdAt: overrides.createdAt ?? iso(),
  };
}

export function makeBundle(overrides: Partial<BundleItem> = {}): BundleItem {
  return {
    id: overrides.id ?? uuid(),
    name: overrides.name ?? "Sample Bundle",
    description: overrides.description ?? "Demo bundle",
    createdAt: overrides.createdAt ?? iso(),
  };
}

export function makeRecipient(overrides: Partial<RecipientItem> = {}): RecipientItem {
  return {
    id: overrides.id ?? uuid(),
    email: overrides.email ?? "user@example.com",
    phone: overrides.phone,
    createdAt: overrides.createdAt ?? iso(),
  };
}

export type { BundleItem, FileItem, RecipientItem };
