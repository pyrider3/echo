import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "mobile"),
  base: "./",
  build: { outDir: resolve(__dirname, "mobile-dist"), emptyOutDir: true },
});
