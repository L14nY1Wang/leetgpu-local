const { test, expect } = require("@playwright/test");

const challenges = [
  { id: "1_vector_add", number: 1, title: "Vector Addition" },
  { id: "2_matrix_multiplication", number: 2, title: "Matrix Multiplication" },
];

async function openSettings(page) {
  let config = {
    tolerances: { "2_matrix_multiplication": { atol: 0.0005, rtol: 0.0001 } },
    float32MatmulPrecision: { "2_matrix_multiplication": "highest" },
  };
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  await page.route("**/api/challenges", (route) => route.fulfill({ json: challenges }));
  await page.route("**/api/judge-overrides", async (route) => {
    if (route.request().method() === "PUT") {
      config = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, config } });
    }
    return route.fulfill({ json: config });
  });
  await page.goto("/settings");
  await expect(page.locator("#settingsRows tr")).toHaveCount(2);
}

test("edits and saves structured judge overrides", async ({ page }) => {
  await openSettings(page);
  const vectorRow = page.locator('tr[data-id="1_vector_add"]');
  await vectorRow.locator('[data-field="atol"]').fill("0.002");
  await vectorRow.locator('[data-field="precision"]').selectOption("high");

  const saveRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/judge-overrides") && request.method() === "PUT"
  );
  await page.getByRole("button", { name: "保存配置" }).click();
  const payload = (await saveRequest).postDataJSON();
  expect(payload.tolerances["1_vector_add"].atol).toBe(0.002);
  expect(payload.float32MatmulPrecision["1_vector_add"]).toBe("high");
  await expect(page.locator("#settingsMessage")).toContainText("下次判题立即生效");
  await page.screenshot({ path: "/tmp/kernelyard-settings-desktop.png", fullPage: true });
});

test("reports invalid raw JSON without sending it", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("tab", { name: "原始 JSON" }).click();
  await page.locator("#jsonEditor").fill("{ invalid");
  let putCount = 0;
  page.on("request", (request) => { if (request.method() === "PUT") putCount += 1; });
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.locator("#settingsMessage")).toContainText("JSON 无效");
  expect(putCount).toBe(0);
});

test("keeps settings controls within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);
  await expect(page.getByRole("button", { name: "保存配置" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/kernelyard-settings-mobile.png", fullPage: true });
});
