/**
 * Gmail action plugin scaffold.
 * Provides a sample action capability that will be replaced with a real implementation.
 */

/** @type {import('@latchflow/core').PluginModule | import('../../core/src/plugins/contracts.js').PluginModule} */
const plugin = {
  name: "@latchflow/plugin-gmail",
  capabilities: [
    {
      kind: "ACTION",
      key: "gmail_email",
      displayName: "Gmail Email Sender",
      configSchema: {
        type: "object",
        properties: {
          sender: { type: "string", description: "Email address used as the sender" },
          clientId: { type: "string" },
          clientSecret: { type: "string" },
          refreshToken: { type: "string" },
        },
        required: ["sender"],
      },
    },
  ],
  actions: {
    gmail_email: () => ({
      async execute(_input) {
        // TODO: implement Gmail send logic via plugin services
        return { output: { status: "noop" } };
      },
    }),
  },
};

export default plugin;
