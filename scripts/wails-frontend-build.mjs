import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = join(root, "frontend");
const frontendDist = join(frontendDir, "dist");
const stagedAssets = join(root, "gateway", "internal", "webassets", "dist");
const gitkeep = join(stagedAssets, ".gitkeep");

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const build = spawnSync(pnpm, ["build"], {
  cwd: frontendDir,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

if (!existsSync(join(frontendDist, "index.html"))) {
  console.error(`frontend build output is missing: ${frontendDist}`);
  process.exit(1);
}

mkdirSync(stagedAssets, { recursive: true });
if (!existsSync(gitkeep)) {
  writeFileSync(gitkeep, "# Frontend production assets are staged here by the release build.\n");
}

for (const name of readdirSync(stagedAssets)) {
  if (name !== ".gitkeep") {
    rmSync(join(stagedAssets, name), { recursive: true, force: true });
  }
}

cpSync(frontendDist, stagedAssets, { recursive: true });
if (!existsSync(gitkeep)) {
  writeFileSync(gitkeep, "# Frontend production assets are staged here by the release build.\n");
}
