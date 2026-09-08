import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = "http://localhost:5175";

export default defineConfig({
  root: "dashboard",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/images": { target: SERVER, changeOrigin: true },
    },
  },
});
