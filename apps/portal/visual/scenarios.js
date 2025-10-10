/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("node:path");
const { buildBundlesNoCooldown } = require("../tests/visual/fixtures/assignments");

const BASE_URL = process.env.PORTAL_VISUAL_BASE_URL ?? "http://127.0.0.1:4300";
const RENDERS_DIR = path.resolve(__dirname, "..", "renders");
const CURRENT_DIR = path.join(RENDERS_DIR, "current");
const DIFF_DIR = path.join(RENDERS_DIR, "diff");

const SCENARIOS = {
  login: {
    id: "login",
    title: "Login form",
    path: "/login",
    requiresSession: false,
    baselineFileName: "mockup_logged_out.png",
    outputFileName: "before_auth_start.png",
    maxDiffRatio: 0.015,
    pixelmatchThreshold: 0.08,
  },
  "logged-in": {
    id: "logged-in",
    title: "Logged in (no cooldowns)",
    path: "/",
    requiresSession: true,
    dataset: buildBundlesNoCooldown,
    baselineFileName: "mockup_logged_in.png",
    outputFileName: "logged_in.png",
    maxDiffRatio: 0.02,
    pixelmatchThreshold: 0.08,
  },
};

module.exports = {
  BASE_URL,
  RENDERS_DIR,
  CURRENT_DIR,
  DIFF_DIR,
  SCENARIOS,
};
