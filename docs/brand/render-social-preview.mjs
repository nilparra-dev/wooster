// Renders social-preview.html to the 1280x640 PNG that GitHub uses as the
// repository's social preview. Playwright comes from the player workspace:
//   npm --prefix frontend ci && node docs/brand/render-social-preview.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.goto(pathToFileURL(`${here}social-preview.html`).href);
  await page.screenshot({ path: `${here}social-preview.png` });
} finally {
  await browser.close();
}
