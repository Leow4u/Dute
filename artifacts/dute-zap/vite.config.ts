import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    host: "0.0.0.0",
  },
});
