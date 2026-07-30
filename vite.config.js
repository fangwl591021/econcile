import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        admin: resolve(import.meta.dirname, "index.html"),
        customer: resolve(import.meta.dirname, "customer.html")
      }
    }
  }
});
