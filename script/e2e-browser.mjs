#!/usr/bin/env node
/** Browser E2E: login → HQ dashboard */
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* optional */
  }
}

loadEnv();

const EMAIL = "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("Body preview:", bodyText.replace(/\n/g, " | "));

  const hasEmail = await page.locator('[data-testid="input-email"]').count();
  if (!hasEmail) {
    console.error("Console errors:", errors.slice(0, 5));
    await page.screenshot({ path: "/tmp/ifcdc-login-fail.png", fullPage: true });
    console.error("Screenshot: /tmp/ifcdc-login-fail.png");
    process.exitCode = 1;
    await browser.close();
    return;
  }

  await page.waitForSelector('[data-testid="input-email"]', { timeout: 5000 });
  await page.fill('[data-testid="input-email"]', EMAIL);
  await page.fill('[data-testid="input-password"]', PASSWORD);
  await page.click('[data-testid="button-submit"]');

  await page.waitForURL(/\/hq/, { timeout: 20000 });
  await page.waitForSelector(".hq-founder-hero", { timeout: 25000 });
  await page.waitForSelector(".hq-kpi-grid", { timeout: 15000 });

  const title = await page.textContent(".hq-page-title");
  const hero = await page.textContent(".hq-founder-hero h2");
  const sidebar = await page.isVisible(".hq-sidebar-logo");

  console.log("URL:", page.url());
  console.log("Page title bar:", title?.trim());
  console.log("Hero:", hero?.trim());
  console.log("Sidebar visible:", sidebar);

  const chunkErr = errors.find((e) => /dynamically imported module|Failed to fetch/i.test(e));
  if (chunkErr) {
    console.error("✗ Chunk load error:", chunkErr);
    process.exitCode = 1;
  } else if (!sidebar || !hero?.includes("Welcome")) {
    console.error("✗ Dashboard did not render fully");
    process.exitCode = 1;
  } else {
    console.log("✓ Login → HQ dashboard verified in browser");
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
