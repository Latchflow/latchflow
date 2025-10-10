#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

const { spawn } = require("node:child_process");
const path = require("node:path");

const portalRoot = path.resolve(__dirname, "..");
const host = process.env.PORTAL_VISUAL_HOST ?? "127.0.0.1";
const port = process.env.PORTAL_VISUAL_PORT ?? process.env.PORT ?? "4300";

const child = spawn("next", ["start", "--hostname", host, "--port", port], {
  cwd: portalRoot,
  env: {
    ...process.env,
    PORT: port,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
