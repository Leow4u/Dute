import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT ?? 4174),
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    port: Number(process.env.PORT ?? 4174),
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
