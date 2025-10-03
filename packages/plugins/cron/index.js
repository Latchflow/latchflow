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

function normalizeConfig(rawConfig, logger) {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Cron trigger requires a configuration object");
  }

  const expression = typeof rawConfig.expression === "string" ? rawConfig.expression.trim() : null;
  if (!expression) {
    throw new Error("Cron trigger requires a non-empty 'expression' property");
  }

  const parsedExpression = parseCronExpression(expression);
  const timezone = rawConfig.timezone ? String(rawConfig.timezone) : "UTC";
  if (timezone.toUpperCase() !== "UTC") {
    logger?.warn?.(
      { timezone },
      "Cron trigger currently supports only the UTC timezone; falling back to UTC",
    );
  }

  const payload =
    typeof rawConfig.payload === "object" && rawConfig.payload !== null
      ? rawConfig.payload
      : undefined;
  const metadata =
    typeof rawConfig.metadata === "object" && rawConfig.metadata !== null
      ? rawConfig.metadata
      : undefined;
  const emitOnStart = rawConfig.emitOnStart === true;

  return {
    expression,
    parsedExpression,
    timezone: "UTC",
    payload,
    metadata,
    emitOnStart,
  };
}

function createCronRuntime(context) {
  const logger = context.services.logger ?? console;
  let config = normalizeConfig(context.config ?? {}, logger);
  let running = false;
  let timer = null;

  const state = {
    get isRunning() {
      return running;
    },
  };

  const scheduleNext = (baseDate = new Date()) => {
    let nextDate;
    try {
      nextDate = computeNextOccurrence(config.parsedExpression, baseDate);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err, expression: config.expression },
        "Failed to compute next cron occurrence; stopping trigger",
      );
      running = false;
      return;
    }
    const delay = Math.max(0, nextDate.getTime() - Date.now());
    timer = setTimeout(async () => {
      if (!running) return;
      await emitCronEvent(nextDate, false);
      if (!running) return;
      scheduleNext(nextDate);
    }, delay);
    logger.debug?.(
      { nextRunAt: nextDate.toISOString(), expression: config.expression },
      "Cron trigger scheduled next run",
    );
  };

  const emitCronEvent = async (scheduledFor, immediate) => {
    const metadata = {
      ...(config.metadata ?? {}),
      cron: {
        expression: config.expression,
        timezone: config.timezone,
        immediate,
      },
    };
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
          expression: config.expression,
        },
        "Cron trigger emit failed",
      );
    }
  };

  const stopTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    async start() {
      if (running) return;
      running = true;
      if (config.emitOnStart) {
        await emitCronEvent(new Date(), true);
      }
      scheduleNext(new Date());
    },
    async stop() {
      running = false;
      stopTimer();
    },
    async onConfigChange(newConfig) {
      config = normalizeConfig(newConfig ?? {}, logger);
      if (!running) return;
      stopTimer();
      if (config.emitOnStart) {
        await emitCronEvent(new Date(), true);
      }
      scheduleNext(new Date());
    },
    async dispose() {
      running = false;
      stopTimer();
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
      displayName: "Cron Schedule",
      configSchema: {
        type: "object",
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
            description: "Emit immediately when the trigger starts or config changes",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  ],
  triggers: {
    cron_schedule: (ctx) => createCronRuntime(ctx),
  },
};

export default plugin;
