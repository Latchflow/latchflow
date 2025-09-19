export type ExecAction = "read" | "create" | "update" | "delete" | "execute" | "manage";

export type ExecResource =
  | "file"
  | "bundle"
  | "recipient"
  | "user"
  | "pipeline"
  | "trigger_def"
  | "action_def"
  | "manual_run"
  // v1 convenience: include plugin admin routes as a first-class resource
  | "plugin"
  | "capability";

export type Permission = {
  action: ExecAction;
  resource: ExecResource | "*";
  where?: {
    bundleIds?: string[];
    pipelineIds?: string[];
    triggerKinds?: string[];
    actionKinds?: string[];
    recipientTagsAny?: string[];
    environments?: ("dev" | "staging" | "prod")[];
    systemOnly?: boolean;
    ownerIsSelf?: boolean;
    timeWindow?: { since: string; until?: string };
  };
  input?: {
    allowParams?: string[];
    denyParams?: string[];
    schemaRefs?: string[];
    valueRules?: Array<{
      path: string;
      oneOf?: string[];
      matches?: string;
      maxLen?: number;
    }>;
    rateLimit?: { perMin?: number; perHour?: number; burst?: number };
    dryRunOnly?: boolean;
  };
};

export type PolicyEntry = {
  action: ExecAction;
  resource: ExecResource;
  // v1 allowance: if not ADMIN, allow executor when true; otherwise deny
  v1AllowExecutor?: boolean;
};

export type Compiled = Record<
  ExecResource,
  Record<ExecAction, { where?: NonNullable<Permission["where"]>[]; input?: Permission["input"][] }>
>;

export type AuthorizeDecision =
  | { ok: true; reason: "ADMIN" | "RULE_MATCH"; inputRules?: NonNullable<Permission["input"]> }
  | { ok: false; reason: "NO_POLICY" | "WHERE_MISS" | "NOT_ADMIN_V1" };
