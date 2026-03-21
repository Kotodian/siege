import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3002";
const OUT = "/root/typescript/src/github.com/Kotodian/siege/docs/screenshots";
const PROJECT = "7dc717ac-a5b5-4add-8bd5-51a8c0053148";
const PLAN = "100ed5f7-7192-4ed8-92d0-2c8b0885c07e"; // testing status, all tabs active

async function main() {
  const browser = await chromium.launch();
  const locale = "zh";

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  // Helper: click a visible tab button
  async function clickTab(text: string) {
    await page.click(`button:visible:has-text("${text}")`, { timeout: 5000 }).catch(() => {
      console.log(`  Tab "${text}" not found or not visible`);
    });
    await page.waitForTimeout(2000);
  }

  // 1. Project list
  await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${locale}/03-project-list.png` });
  console.log("1. Project list");

  // 2. Plan list
  await page.goto(`${BASE}/${locale}/projects/${PROJECT}`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${locale}/04-plan-list.png` });
  console.log("2. Plan list");

  // 3. Plan detail — scheme tab (default)
  await page.goto(`${BASE}/${locale}/projects/${PROJECT}/plans/${PLAN}`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${locale}/05-scheme-detail.png` });
  console.log("3. Scheme detail");

  // 4. Schedule tab
  await clickTab("排期");
  await page.screenshot({ path: `${OUT}/${locale}/09-schedule-gantt.png` });
  console.log("4. Schedule");

  // 5. Review tab
  await clickTab("审查");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/${locale}/07-code-review-diff.png` });
  console.log("5. Review");

  // 6. Test tab
  await clickTab("测试");
  await page.screenshot({ path: `${OUT}/${locale}/14-test-view.png` });
  console.log("6. Test");

  // 7. Publish tab
  await clickTab("发布");
  await page.screenshot({ path: `${OUT}/${locale}/15-publish.png` });
  console.log("7. Publish");

  // 8. Settings
  await page.goto(`${BASE}/${locale}/settings`, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/${locale}/06-settings.png` });
  console.log("8. Settings");

  await ctx.close();
  await browser.close();
  console.log("All done!");
}

main().catch(console.error);
