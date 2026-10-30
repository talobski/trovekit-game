import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": r("./src") } },
  build: {
    rollupOptions: {
      input: { index: r("./index.html"), admin: r("./admin.html") },
    },
  },
})
