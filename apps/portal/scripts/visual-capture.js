#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { once } = require("node:events");
const { setTimeout: sleep } = require("node:timers/promises");
const { chromium } = require("@playwright/test");
const { PNG } = require("pngjs");
const { compareImageFiles } = require("../tests/visual/utils/image-compare");

let BASE_URL;
let RENDERS_DIR;
let CURRENT_DIR;
let DIFF_DIR;
let SCENARIOS;

const SESSION_COOKIE_NAME = process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? "lf_recipient_sess";

const VISUAL_COMMAND = process.env.PORTAL_VISUAL_COMMAND ?? "pnpm run start:visual";
const VISUAL_BUILD_COMMAND = process.env.PORTAL_VISUAL_BUILD_COMMAND ?? "pnpm run build";
const SKIP_BUILD = process.env.PORTAL_VISUAL_SKIP_BUILD === "1";

const PORTAL_ROOT = path.resolve(__dirname, "..");

let activeServer = null;
let exitHandlersAttached = false;

async function main() {
  await initializeEnvironment();

  const [arg] = parseArgs();

  if (arg === "help" || arg === "--help" || arg === "-h") {
    printHelp();
    return;
  }

  if (arg === "list") {
    listScenarios();
    return;
  }

  const scenarioIds = arg && arg !== "all" ? [arg] : Object.keys(SCENARIOS);

  const missing = scenarioIds.filter((id) => !SCENARIOS[id]);
  if (missing.length > 0) {
    console.error(
      `Unknown scenario(s): ${missing.join(
        ", ",
      )}\nRun "pnpm run visual:capture -- list" to see options.`,
    );
    process.exitCode = 1;
    return;
  }

  await ensureDirectories();
  await ensureBuild();
  const server = await startServer();

  try {
    await waitForServer();
    for (const id of scenarioIds) {
      const scenario = SCENARIOS[id];
      console.log(`\n[visual] Capturing "${scenario.title}" (${scenario.id})`);
      await captureScenario(scenario);
    }
  } finally {
    await stopServer(server);
  }
}

async function initializeEnvironment() {
  const preferredPort = Number(process.env.PORTAL_VISUAL_PORT ?? "4300");
  const requestedBaseUrl = process.env.PORTAL_VISUAL_BASE_URL;

  if (!requestedBaseUrl) {
    const port = await findAvailablePort(preferredPort);
    const baseUrl = `http://127.0.0.1:${port}`;
    process.env.PORTAL_VISUAL_PORT = String(port);
    process.env.PORTAL_VISUAL_BASE_URL = baseUrl;
    process.env.PORTAL_VISUAL_HOST = "127.0.0.1";
  } else {
    try {
      const url = new URL(requestedBaseUrl);
      process.env.PORTAL_VISUAL_HOST = url.hostname;
      if (!process.env.PORTAL_VISUAL_PORT && url.port) {
        process.env.PORTAL_VISUAL_PORT = url.port;
      }
    } catch (error) {
      throw new Error(
        `Invalid PORTAL_VISUAL_BASE_URL "${requestedBaseUrl}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const scenariosModule = require("../visual/scenarios");
  ({ BASE_URL, RENDERS_DIR, CURRENT_DIR, DIFF_DIR, SCENARIOS } = scenariosModule);

  console.log(
    `[visual] Using portal base URL ${BASE_URL} (port ${process.env.PORTAL_VISUAL_PORT})`,
  );
}

function parseArgs() {
  const [, , ...rest] = process.argv;
  return rest.filter((value) => value !== "--");
}

function printHelp() {
  console.log(`Usage:
  pnpm run visual:capture -- [scenario]

Scenarios:
${Object.values(SCENARIOS)
  .map((scenario) => `  - ${scenario.id} : ${scenario.title}`)
  .join("\n")}

Flags:
  -- list      Show available scenarios
  -h, --help   Show this help message

Examples:
  pnpm run visual:capture -- login
  pnpm run visual:capture -- logged-in
  pnpm run visual:capture          # capture all
`);
}

function listScenarios() {
  console.log("Available scenarios:");
  for (const scenario of Object.values(SCENARIOS)) {
    console.log(`- ${scenario.id} (${scenario.title}) → ${scenario.path}`);
  }
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(RENDERS_DIR, { recursive: true }),
    fs.mkdir(CURRENT_DIR, { recursive: true }),
    fs.mkdir(DIFF_DIR, { recursive: true }),
  ]);
}

async function startServer() {
  if (await isServerRunning()) {
    console.log(`[visual] Detected running portal at ${BASE_URL}; reusing existing server.`);
    activeServer = null;
    return null;
  }

  console.log(`[visual] Starting portal dev server: ${VISUAL_COMMAND}`);
  const [command, args] = splitCommand(VISUAL_COMMAND);
  const childEnv = { ...process.env };
  const baseUrl = new URL(BASE_URL);
  const port = baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80");

  if (!childEnv.NODE_ENV) {
    childEnv.NODE_ENV = VISUAL_COMMAND.includes("dev") ? "development" : "production";
  }
  childEnv.NEXT_PUBLIC_CORE_API_URL = BASE_URL;
  childEnv.NEXT_PUBLIC_SESSION_COOKIE_NAME = SESSION_COOKIE_NAME;
  childEnv.PORTAL_VISUAL_BASE_URL = BASE_URL;
  childEnv.PORTAL_VISUAL_HOST = baseUrl.hostname;
  childEnv.PORTAL_VISUAL_PORT = port;
  childEnv.PORT = port;
  childEnv.NEXT_TELEMETRY_DISABLED = "1";

  const child = spawn(command, args, {
    cwd: PORTAL_ROOT,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[visual] Dev server exited with code ${code}`);
    }
  });

  activeServer = child;
  attachExitHandlers();

  return child;
}

async function waitForServer() {
  const maxAttempts = 60;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isServerRunning()) {
      console.log(`[visual] Server ready at ${BASE_URL}`);
      return;
    }
    if (activeServer && activeServer.exitCode !== null) {
      throw new Error(
        `Portal dev server exited with code ${activeServer.exitCode}. See logs above.`,
      );
    }
    console.log(`[visual] Waiting for server (${attempt}/${maxAttempts})...`);
    await sleep(delayMs);
  }

  throw new Error(
    `Portal dev server did not become ready at ${BASE_URL} within ${(
      (maxAttempts * delayMs) /
      1000
    ).toFixed(0)} seconds.`,
  );
}

async function captureScenario(scenario) {
  await ensureBrowserInstalledOnce();

  const browser = await chromium.launch();
  const baselinePath = path.join(RENDERS_DIR, scenario.baselineFileName);
  const viewportMeta = await determineViewport(baselinePath);
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: viewportMeta.width, height: viewportMeta.height },
    colorScheme: "light",
  });

  try {
    if (viewportMeta.source === "baseline") {
      console.log(
        `[visual] Matching baseline dimensions: ${viewportMeta.width}x${viewportMeta.height}`,
      );
    }

    if (scenario.requiresSession) {
      await context.addCookies([
        {
          name: SESSION_COOKIE_NAME,
          value: "visual-session",
          url: BASE_URL,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ]);
    }

    const page = await context.newPage();

    if (scenario.dataset) {
      const payload =
        typeof scenario.dataset === "function" ? scenario.dataset() : scenario.dataset;
      await page.route("**/portal/bundles**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": BASE_URL,
            "access-control-allow-credentials": "true",
            vary: "Origin",
          },
          body: JSON.stringify(payload),
        });
      });
    }

    await page.goto(scenario.path, { waitUntil: "networkidle" });

    if (scenario.afterNavigate) {
      await scenario.afterNavigate({ page, context, baseURL: BASE_URL });
    }

    await hideToasts(page);
    await page.waitForTimeout(250);

    const actualPath = path.join(CURRENT_DIR, scenario.outputFileName);
    await fs.mkdir(path.dirname(actualPath), { recursive: true });
    await page.screenshot({ path: actualPath, fullPage: true });

    console.log(`[visual] Saved current render → ${relative(actualPath)}`);

    if (await fileExists(baselinePath)) {
      const diffPath = path.join(DIFF_DIR, scenario.outputFileName);
      try {
        const result = await compareImageFiles(baselinePath, actualPath, diffPath, {
          threshold: scenario.pixelmatchThreshold ?? 0.08,
        });

        console.log(
          `[visual] Diff: ${(result.diffRatio * 100).toFixed(2)}% (${result.diffPixels} pixels) → ${relative(diffPath)}`,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("Image dimensions differ")) {
          const [baselineDims, actualDims] = await Promise.all([
            getImageDimensionsSafe(baselinePath),
            getImageDimensionsSafe(actualPath),
          ]);
          await fs.mkdir(path.dirname(diffPath), { recursive: true });
          await fs.copyFile(actualPath, diffPath);
          console.warn(
            `[visual] Skipped diff for ${scenario.id}: baseline ${formatDimensions(
              baselineDims,
            )}, actual ${formatDimensions(actualDims)}. Saved actual render to ${relative(
              diffPath,
            )}. Update the baseline or adjust the scenario viewport.`,
          );
        } else {
          throw error;
        }
      }
    } else {
      console.warn(
        `[visual] Baseline not found for ${scenario.id}. Expected at ${relative(baselinePath)}`,
      );
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function stopServer(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode) {
    activeServer = null;
    return;
  }

  console.log("[visual] Stopping portal dev server...");

  const gracefulTimeoutMs = 5000;

  child.kill("SIGTERM");

  try {
    await Promise.race([once(child, "exit"), sleep(gracefulTimeoutMs)]);
  } catch {
    // ignore
  }

  if (child.exitCode === null && !child.killed) {
    console.warn("[visual] Dev server still running after SIGTERM. Forcing shutdown.");
    child.kill("SIGKILL");
    try {
      await once(child, "exit");
    } catch {
      // ignore
    }
  }

  console.log("[visual] Portal dev server stopped.");

  activeServer = null;
}

async function hideToasts(page) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-sonner-toast]").forEach((element) => element.remove());
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function relative(targetPath) {
  return path.relative(process.cwd(), targetPath);
}

let browserReady = false;

async function ensureBrowserInstalledOnce() {
  if (browserReady) {
    return;
  }

  const executablePath = chromium.executablePath();
  try {
    await fs.access(executablePath);
    browserReady = true;
    return;
  } catch {
    // fall through
  }

  console.log("[visual] Installing Playwright Chromium browser (first run)...");
  await runCommand("pnpm", ["exec", "playwright", "install", "chromium"]);

  // verify installation succeeded
  try {
    await fs.access(chromium.executablePath());
    browserReady = true;
  } catch (error) {
    console.error("[visual] Failed to install Playwright Chromium browser.");
    throw error;
  }
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
      shell: options.shell ?? false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}

async function determineViewport(baselinePath) {
  const defaultViewport = { width: 1280, height: 720, source: "default" };
  if (!(await fileExists(baselinePath))) {
    return defaultViewport;
  }

  const dimensions = await getImageDimensionsSafe(baselinePath);
  if (dimensions.width && dimensions.height) {
    return {
      width: dimensions.width,
      height: dimensions.height,
      source: "baseline",
    };
  }

  return defaultViewport;
}

async function getImageDimensionsSafe(imagePath) {
  try {
    const buffer = await fs.readFile(imagePath);
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

function formatDimensions({ width, height }) {
  if (!width || !height) {
    return "unknown";
  }
  return `${width}x${height}`;
}

function attachExitHandlers() {
  if (exitHandlersAttached) {
    return;
  }
  exitHandlersAttached = true;

  const terminate = async (signal) => {
    if (activeServer) {
      await stopServer(activeServer);
    }
    process.exit(signal ? 1 : 0);
  };

  process.on("SIGINT", () => {
    terminate("SIGINT").catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    terminate("SIGTERM").catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });
  process.on("exit", () => {
    if (activeServer) {
      activeServer.kill("SIGTERM");
    }
  });
}

async function ensureBuild() {
  if (SKIP_BUILD) {
    console.log("[visual] Skipping build step (PORTAL_VISUAL_SKIP_BUILD=1).");
    return;
  }

  console.log(`[visual] Building portal with "${VISUAL_BUILD_COMMAND}"...`);
  const [command, args] = splitCommand(VISUAL_BUILD_COMMAND);
  await runCommand(command, args, {
    cwd: PORTAL_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_CORE_API_URL: BASE_URL,
      NEXT_PUBLIC_SESSION_COOKIE_NAME: SESSION_COOKIE_NAME,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  console.log("[visual] Build complete.");
}

function splitCommand(commandString) {
  const parts = commandString
    .trim()
    .split(" ")
    .filter((part) => part.length > 0);
  const [command, ...args] = parts;
  if (!command) {
    throw new Error(`Invalid command string "${commandString}"`);
  }
  return [command, args];
}

async function isServerRunning() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(BASE_URL, {
      method: "HEAD",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findAvailablePort(startPort) {
  const maxAttempts = 20;
  let port = Number.isInteger(startPort) && startPort > 0 ? startPort : 4300;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isPortFree(port)) {
      if (attempt > 0) {
        console.log(
          `[visual] Selected alternative port ${port} (initial ${startPort} was in use).`,
        );
      }
      return port;
    }
    port += 1;
  }

  throw new Error(
    `Unable to find an available port starting from ${startPort}. Consider setting PORTAL_VISUAL_PORT manually.`,
  );
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => {
        resolve(false);
      })
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, "127.0.0.1");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
