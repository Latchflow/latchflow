import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

function repoRootFromHere(): string {
  // This file lives at packages/core/tests/helpers/db.ts
  const here = fileURLToPath(new URL("./", import.meta.url));
  return path.join(here, "../../../../");
}

export async function prismaMigrateDeploy(databaseUrl: string): Promise<void> {
  const cwd = repoRootFromHere();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["-s", "-F", "@latchflow/db", "exec", "prisma", "migrate", "deploy"],
      {
        cwd,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma migrate deploy failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

export async function prismaGenerate(databaseUrl: string): Promise<void> {
  const cwd = repoRootFromHere();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["-s", "-F", "@latchflow/db", "exec", "prisma", "generate"],
      {
        cwd,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma generate failed with code ${code}`));
    });
    child.on("error", reject);
  });
}
