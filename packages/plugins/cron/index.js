/**
 * Cron trigger plugin scaffold.
 * Provides a sample trigger capability that will be replaced with a real implementation.
 */

/** @type {import('@latchflow/core').PluginModule | import('../../core/src/plugins/contracts.js').PluginModule} */
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
            description: "Cron expression in UTC",
          },
        },
        required: ["expression"],
      },
    },
  ],
  triggers: {
    cron_schedule: () => ({
      async start() {
        // TODO: schedule cron expression
      },
      async stop() {
        // TODO: cancel scheduled job
      },
    }),
  },
};

export default plugin;
