const FIELD_DEFS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAME_MAP() },
  { name: "dayOfWeek", min: 0, max: 6, names: DAY_OF_WEEK_MAP() },
];

const MAX_ITERATIONS = 366 * 24 * 60; // one year in minutes

function MONTH_NAME_MAP() {
  return {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  };
}

function DAY_OF_WEEK_MAP() {
  return {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };
}

function parseCronExpression(expression) {
  if (typeof expression !== "string" || !expression.trim()) {
    throw new Error("Cron expression must be a non-empty string");
  }
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      "Cron expression must contain exactly 5 fields (minute hour day-of-month month day-of-week)",
    );
  }

  return parts.map((part, index) => parseField(part, FIELD_DEFS[index]));
}

function parseField(field, def) {
  const raw = field.trim();
  const values = new Set();
  const isWildcard = raw === "*" || raw === "?";

  const segments = raw.split(",");
  for (const segment of segments) {
    expandSegment(segment.trim(), def, values);
  }

  if (values.size === 0) {
    for (let v = def.min; v <= def.max; v += 1) {
      values.add(normalizeValue(v, def));
    }
  }

  return { values, isWildcard };
}

function expandSegment(segment, def, collector) {
  if (!segment || segment === "*" || segment === "?") {
    for (let v = def.min; v <= def.max; v += 1) {
      collector.add(normalizeValue(v, def));
    }
    return;
  }

  let rangePart = segment;
  let step = 1;

  if (segment.includes("/")) {
    const [lhs, rhs] = segment.split("/");
    rangePart = lhs || "*";
    step = Number.parseInt(rhs, 10);
    if (Number.isNaN(step) || step <= 0) {
      throw new Error(`Invalid cron step value: ${segment}`);
    }
  }

  let start;
  let end;

  if (rangePart === "*" || rangePart === "?") {
    start = def.min;
    end = def.max;
  } else if (rangePart.includes("-")) {
    const [lhs, rhs] = rangePart.split("-");
    start = normalizeValue(lhs, def);
    end = normalizeValue(rhs, def);
  } else {
    const single = normalizeValue(rangePart, def);
    start = single;
    end = single;
  }

  if (start > end) {
    throw new Error(`Invalid cron range: ${segment}`);
  }

  for (let value = start; value <= end; value += step) {
    collector.add(normalizeValue(value, def));
  }
}

function normalizeValue(value, def) {
  if (typeof value === "string") {
    const token = value.trim().toUpperCase();
    if (def.names && token in def.names) {
      return def.names[token];
    }
    const numeric = Number.parseInt(token, 10);
    if (Number.isNaN(numeric)) {
      throw new Error(`Invalid cron value: ${value}`);
    }
    return mapDayOfWeek(numeric, def);
  }
  return mapDayOfWeek(value, def);
}

function mapDayOfWeek(value, def) {
  if (def.name === "dayOfWeek" && value === 7) {
    return 0;
  }
  if (value < def.min || value > def.max) {
    throw new Error(`Cron value out of range for ${def.name}: ${value}`);
  }
  return value;
}

function computeNextOccurrence(parsedExpression, fromDate) {
  const start = new Date(fromDate.getTime());
  start.setUTCSeconds(0, 0);
  let candidate = new Date(start.getTime() + 60_000);

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    if (matchesExpression(parsedExpression, candidate, start)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error("Unable to resolve next cron execution within one year");
}

function matchesExpression(parsed, date) {
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parsed;
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();

  if (!minuteField.values.has(minute)) return false;
  if (!hourField.values.has(hour)) return false;
  if (!monthField.values.has(month)) return false;

  const domMatch = dayOfMonthField.values.has(dayOfMonth);
  const dowMatch = dayOfWeekField.values.has(dayOfWeek);

  if (!dayOfMonthField.isWildcard && !dayOfWeekField.isWildcard) {
    if (domMatch || dowMatch) {
      return domMatch || dowMatch;
    }
    return false;
  }
  if (!dayOfMonthField.isWildcard && !domMatch) return false;
  if (!dayOfWeekField.isWildcard && !dowMatch) return false;
  return true;
}

const SCHEDULE_MODES = {
  CRON: "cron",
  ONE_TIME: "one_time",
};

function normalizeTimezone(timezone, logger) {
  const tz = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
  if (tz.toUpperCase() !== "UTC") {
    logger?.warn?.(
      { timezone: tz },
      "Scheduled trigger currently supports only the UTC timezone; falling back to UTC",
    );
  }
  return "UTC";
}

function inferScheduleMode(rawConfig) {
  const explicit = typeof rawConfig.mode === "string" ? rawConfig.mode.trim().toLowerCase() : null;
  if (explicit === SCHEDULE_MODES.ONE_TIME) return SCHEDULE_MODES.ONE_TIME;
  if (explicit === SCHEDULE_MODES.CRON) return SCHEDULE_MODES.CRON;

  if (
    rawConfig.once &&
    typeof rawConfig.once === "object" &&
    typeof rawConfig.once.runAt === "string" &&
    rawConfig.once.runAt.trim().length > 0
  ) {
    return SCHEDULE_MODES.ONE_TIME;
  }
  if (typeof rawConfig.runAt === "string" && rawConfig.runAt.trim().length > 0) {
    return SCHEDULE_MODES.ONE_TIME;
  }
  return SCHEDULE_MODES.CRON;
}

function parseRunAt(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "Scheduled trigger requires a non-empty 'runAt' ISO timestamp for one-time mode",
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp for runAt: ${value}`);
  }
  return parsed;
}

function normalizeConfig(rawConfig, logger) {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Scheduled trigger requires a configuration object");
  }

  const payload =
    typeof rawConfig.payload === "object" && rawConfig.payload !== null
      ? rawConfig.payload
      : undefined;
  const metadata =
    typeof rawConfig.metadata === "object" && rawConfig.metadata !== null
      ? rawConfig.metadata
      : undefined;

  const mode = inferScheduleMode(rawConfig);

  if (mode === SCHEDULE_MODES.CRON) {
    const cronConfig =
      rawConfig.cron && typeof rawConfig.cron === "object" && rawConfig.cron !== null
        ? rawConfig.cron
        : rawConfig;
    const expression =
      typeof cronConfig.expression === "string"
        ? cronConfig.expression.trim()
        : typeof rawConfig.expression === "string"
          ? rawConfig.expression.trim()
          : null;
    if (!expression) {
      throw new Error("Scheduled trigger requires a non-empty 'expression' when mode is cron");
    }

    const parsedExpression = parseCronExpression(expression);
    const timezone = normalizeTimezone(cronConfig.timezone ?? rawConfig.timezone, logger);
    const emitOnStart = cronConfig.emitOnStart === true || rawConfig.emitOnStart === true;

    return {
      mode,
      cron: {
        expression,
        parsedExpression,
        timezone,
      },
      once: null,
      payload,
      metadata,
      emitOnStart,
    };
  }

  const oneTimeConfig =
    rawConfig.once && typeof rawConfig.once === "object" && rawConfig.once !== null
      ? rawConfig.once
      : rawConfig;
  const runAtInput =
    typeof oneTimeConfig.runAt === "string"
      ? oneTimeConfig.runAt
      : typeof rawConfig.runAt === "string"
        ? rawConfig.runAt
        : null;
  if (!runAtInput) {
    throw new Error("Scheduled trigger requires 'runAt' when mode is one_time");
  }

  const runAt = parseRunAt(runAtInput);
  const timezone = normalizeTimezone(oneTimeConfig.timezone ?? rawConfig.timezone, logger);

  return {
    mode,
    cron: null,
    once: {
      runAt,
      timezone,
    },
    payload,
    metadata,
    emitOnStart: false,
  };
}

function createScheduledRuntime(context) {
  const logger = context.services.logger ?? console;
  let config = normalizeConfig(context.config ?? {}, logger);
  let running = false;
  let timer = null;
  let nextRunAt = null;
  let onceHasFired = false;
  let lastOnceRunAtMs =
    config.mode === SCHEDULE_MODES.ONE_TIME ? config.once.runAt.getTime() : null;

  const state = {
    get isRunning() {
      return running;
    },
    get mode() {
      return config.mode;
    },
    get nextRunAt() {
      return nextRunAt;
    },
    get hasFired() {
      return onceHasFired;
    },
  };

  const emitScheduledEvent = async (scheduledFor, immediate) => {
    const metadata = { ...(config.metadata ?? {}) };
    if (config.mode === SCHEDULE_MODES.CRON && config.cron) {
      metadata.cron = {
        expression: config.cron.expression,
        timezone: config.cron.timezone,
        immediate,
      };
    }
    const scheduleMetadata =
      config.mode === SCHEDULE_MODES.CRON && config.cron
        ? {
            kind: SCHEDULE_MODES.CRON,
            expression: config.cron.expression,
            timezone: config.cron.timezone,
            immediate,
          }
        : config.once
          ? {
              kind: SCHEDULE_MODES.ONE_TIME,
              runAt: config.once.runAt.toISOString(),
              timezone: config.once.timezone,
              immediate,
            }
          : undefined;
    if (scheduleMetadata) {
      metadata.schedule = scheduleMetadata;
    }

    try {
      await context.services.emit({
        scheduledFor,
        context: config.payload,
        metadata,
      });
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : err,
          mode: config.mode,
        },
        "Scheduled trigger emit failed",
      );
    }
  };

  const stopTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleCron = (baseDate = new Date()) => {
    if (!config.cron) {
      logger.error({ mode: config.mode }, "Cron scheduler invoked without cron configuration");
      return;
    }

    let nextDate;
    try {
      nextDate = computeNextOccurrence(config.cron.parsedExpression, baseDate);
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : err,
          expression: config.cron.expression,
        },
        "Failed to compute next cron occurrence; stopping trigger",
      );
      running = false;
      nextRunAt = null;
      return;
    }
    const delay = Math.max(0, nextDate.getTime() - Date.now());
    nextRunAt = nextDate;
    timer = setTimeout(async () => {
      if (!running) return;
      await emitScheduledEvent(nextDate, false);
      if (!running) return;
      scheduleCron(nextDate);
    }, delay);
    logger.debug?.(
      { nextRunAt: nextDate.toISOString(), mode: config.mode },
      "Scheduled trigger queued next cron run",
    );
  };

  const scheduleOneTime = () => {
    if (!config.once) {
      logger.error({ mode: config.mode }, "One-time scheduler invoked without runAt configuration");
      return;
    }

    const runAt = config.once.runAt;
    const runAtMs = runAt.getTime();
    if (onceHasFired && runAtMs === lastOnceRunAtMs) {
      nextRunAt = null;
      return;
    }

    lastOnceRunAtMs = runAtMs;
    const delay = runAtMs - Date.now();
    nextRunAt = delay > 0 ? runAt : null;

    if (delay <= 0) {
      onceHasFired = true;
      nextRunAt = null;
      // Fire asynchronously to mirror timer behavior
      void emitScheduledEvent(runAt, true);
      return;
    }

    timer = setTimeout(async () => {
      if (!running) return;
      onceHasFired = true;
      nextRunAt = null;
      await emitScheduledEvent(runAt, false);
    }, delay);
    logger.debug?.(
      { runAt: runAt.toISOString(), mode: config.mode },
      "Scheduled trigger queued one-time execution",
    );
  };

  const scheduleNext = (baseDate = new Date()) => {
    stopTimer();
    if (config.mode === SCHEDULE_MODES.CRON) {
      scheduleCron(baseDate);
      return;
    }
    scheduleOneTime();
  };

  return {
    async start() {
      if (running) return;
      running = true;
      if (config.mode === SCHEDULE_MODES.CRON && config.emitOnStart) {
        await emitScheduledEvent(new Date(), true);
      }
      scheduleNext(new Date());
    },
    async stop() {
      running = false;
      stopTimer();
      nextRunAt = null;
    },
    async onConfigChange(newConfig) {
      config = normalizeConfig(newConfig ?? {}, logger);
      if (config.mode === SCHEDULE_MODES.ONE_TIME) {
        const ms = config.once.runAt.getTime();
        if (ms !== lastOnceRunAtMs) {
          onceHasFired = false;
        }
        lastOnceRunAtMs = ms;
      } else {
        onceHasFired = false;
        lastOnceRunAtMs = null;
      }
      if (!running) return;
      stopTimer();
      if (config.mode === SCHEDULE_MODES.CRON && config.emitOnStart) {
        await emitScheduledEvent(new Date(), true);
      }
      scheduleNext(new Date());
    },
    async dispose() {
      running = false;
      stopTimer();
      nextRunAt = null;
    },
    state,
  };
}

/** @type {import("../../core/src/plugins/contracts.js").PluginModule} */
const plugin = {
  name: "@latchflow/plugin-cron",
  capabilities: [
    {
      kind: "TRIGGER",
      key: "cron_schedule",
      displayName: "Scheduled Trigger",
      configSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["cron", "one_time"],
            description: "Scheduling mode: recurring cron or single run at a timestamp",
          },
          expression: {
            type: "string",
            description:
              "Cron expression (minute hour day-of-month month day-of-week) evaluated in UTC. Legacy fallback when mode is omitted.",
          },
          cron: {
            type: "object",
            additionalProperties: false,
            properties: {
              expression: {
                type: "string",
                description:
                  "Cron expression (minute hour day-of-month month day-of-week) evaluated in UTC",
              },
              timezone: {
                type: "string",
                description: "IANA timezone identifier (currently only UTC is supported)",
              },
              emitOnStart: {
                type: "boolean",
                description: "Emit immediately when the trigger starts or config changes",
              },
            },
          },
          timezone: {
            type: "string",
            description: "IANA timezone identifier (currently only UTC is supported)",
          },
          runAt: {
            type: "string",
            format: "date-time",
            description: "ISO timestamp for a one-time execution (UTC recommended)",
          },
          once: {
            type: "object",
            additionalProperties: false,
            properties: {
              runAt: {
                type: "string",
                format: "date-time",
                description: "ISO timestamp for a one-time execution (UTC recommended)",
              },
              timezone: {
                type: "string",
                description: "IANA timezone identifier (currently only UTC is supported)",
              },
            },
          },
          payload: {
            type: "object",
            description: "Static payload delivered with each trigger event",
          },
          metadata: {
            type: "object",
            description: "Additional metadata merged into emitted events",
          },
          emitOnStart: {
            type: "boolean",
            description:
              "Emit immediately when the trigger starts or config changes (cron mode only)",
          },
        },
        anyOf: [
          {
            properties: { mode: { const: "one_time" } },
            required: ["mode"],
            anyOf: [{ required: ["runAt"] }, { required: ["once"] }],
          },
          { required: ["expression"] },
          { required: ["cron"] },
        ],
        additionalProperties: false,
      },
    },
  ],
  triggers: {
    cron_schedule: (ctx) => createScheduledRuntime(ctx),
  },
};

export default plugin;
