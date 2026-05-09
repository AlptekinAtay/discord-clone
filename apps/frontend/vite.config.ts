import { defineConfig, loadEnv } from "vite"; // 1. loadEnv ekledik
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => { // 2. (async () =>) yerine ({ mode }) yaptık
  // .env dosyasını Vite'ın anlayacağı şekilde manuel yüklüyoruz
  const env = loadEnv(mode, process.cwd(), '');
  const APP_DOMAIN = env.VITE_APP_DOMAIN || "localhost";
  const tauriHost = process.env.TAURI_DEV_HOST;

  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: tauriHost || true,
      allowedHosts: [APP_DOMAIN], 
      hmr: tauriHost
        ? {
            protocol: "ws",
            host: tauriHost,
            port: 1421,
          }
        : {
            protocol: "wss",
            host: APP_DOMAIN,
            clientPort: 443,
          },
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});