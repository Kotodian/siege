import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3002";
const OUT = "/root/typescript/src/github.com/Kotodian/siege/docs/screenshots";

async function main() {
  const browser = await chromium.launch();

  for (const locale of ["zh", "en"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    });
    const page = await ctx.newPage();

    // Project list
    await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${locale}/03-project-list.png` });

    // Find first project link
    const projectLink = await page.$("a[href*='/projects/']");
    if (projectLink) {
      await projectLink.click();
      await page.waitForTimeout(1500);

      // Plan list
      await page.screenshot({ path: `${OUT}/${locale}/04-plan-list.png` });

      // Click first plan
      const planCard = await page.$("[class*='cursor-pointer']");
      if (planCard) {
        await planCard.click();
        await page.waitForTimeout(1500);

        // Scheme detail
        await page.screenshot({ path: `${OUT}/${locale}/05-scheme-detail.png` });

        // Click schedule tab
        const scheduleTab = await page.$("button:has-text('排期'), button:has-text('Schedule')");
        if (scheduleTab) {
          await scheduleTab.click();
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${OUT}/${locale}/09-schedule-gantt.png` });
        }

        // Click code review tab
        const reviewTab = await page.$("button:has-text('代码审查'), button:has-text('Code Review')");
        if (reviewTab) {
          await reviewTab.click();
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${OUT}/${locale}/07-code-review-diff.png` });
        }

        // Click test tab
        const testTab = await page.$("button:has-text('测试'), button:has-text('Tests')");
        if (testTab) {
          await testTab.click();
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${OUT}/${locale}/14-test-view.png` });
        }
      }
    }

    // Settings
    await page.goto(`${BASE}/${locale}/settings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${locale}/06-settings.png` });

    await ctx.close();
  }

  await browser.close();
  console.log("Done!");
}

main().catch(console.error);
