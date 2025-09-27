export type SystemConfigValue = {
  key: string;
  value: unknown;
  category?: string | null;
  schema?: unknown | null;
  metadata?: unknown | null;
  isSecret: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
  source: "database" | "database_seeded" | "environment";
};

export type BulkConfigInput = {
  key: string;
  value?: unknown;
  category?: string;
  schema?: unknown;
  metadata?: unknown;
  isSecret?: boolean;
};

export type BulkConfigResult = {
  success: SystemConfigValue[];
  errors: Array<{ key: string; error: string }>;
};

export type SystemConfigOptions = {
  category?: string;
  schema?: unknown;
  metadata?: unknown;
  isSecret?: boolean;
  userId?: string;
};

export type FilterOptions = {
  keys?: string[];
  category?: string;
  includeSecrets?: boolean;
  offset?: number;
  limit?: number;
};
