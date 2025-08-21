// Lightweight placeholder types to unblock usage without generators.
// In CI we will enforce spec-hash regeneration to catch drift.

export type UUID = string;

export interface FileItem {
  id: UUID;
  name: string;
  size: number;
  contentType?: string;
  createdAt: string;
}

export interface BundleItem {
  id: UUID;
  name: string;
  description?: string;
  createdAt: string;
}

export interface RecipientItem {
  id: UUID;
  email?: string;
  phone?: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string };
}
