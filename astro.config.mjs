// @ts-check
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

const dashboard = JSON.parse(
  readFileSync(new URL("./src/data/dashboard.json", import.meta.url), "utf8"),
);

const HOME_UPDATED = "2026-11-04";

// https://astro.build/config
export default defineConfig({
  site: "https://kubetee.ai",
  integrations: [
    sitemap({
      serialize(item) {
        const path = new URL(item.url).pathname;
        item.lastmod = path.startsWith("/dashboard") ? dashboard.generatedAt : HOME_UPDATED;
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
