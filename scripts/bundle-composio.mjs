import { build } from "esbuild";

await build({
  entryPoints: ["server/composio-runtime.ts"],
  outfile: "dist-server/composio-runtime.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  legalComments: "none",
});
