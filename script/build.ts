import { build as esbuild } from "esbuild";
import { readFile, rm } from "fs/promises";
import { build as viteBuild } from "vite";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "typesense",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("building pipeline...");
  await esbuild({
    entryPoints: ["scripts/pipeline/run-pipeline.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/pipeline.cjs",
    banner: {
      js: 'var __pipeline_import_meta_url=require("url").pathToFileURL(require("path").join(process.cwd(),"scripts","pipeline","__bundled.cjs")).href;',
    },
    define: {
      "import.meta.url": "__pipeline_import_meta_url",
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("building typesense indexer...");
  await esbuild({
    entryPoints: ["scripts/typesense-index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/typesense-index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
