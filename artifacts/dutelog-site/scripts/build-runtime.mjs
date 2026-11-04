import { build } from "esbuild";
await build({ entryPoints: ["server/index.ts"], outfile: "dist/runtime/index.mjs", platform: "node", target: "node22", format: "esm", bundle: true, packages: "external", sourcemap: false });
