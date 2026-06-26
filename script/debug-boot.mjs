#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5001";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  const failed = [];

  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (req) => failed.push(`${req.failure()?.errorText} ${req.url()}`));

  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log("=== Failed requests ===");
  failed.forEach((f) => console.log(f));
  console.log("=== Console ===");
  logs.forEach((l) => console.log(l));
  console.log("=== Boot still visible? ===");
  console.log(await page.evaluate(() => ({
    boot: document.getElementById("app-boot")?.innerText,
    rootHtml: document.getElementById("root")?.innerHTML?.slice(0, 200),
    mounted: window.__IFCDC_APP_MOUNTED__,
  })));

  await browser.close();
}

main().catch(console.error);
