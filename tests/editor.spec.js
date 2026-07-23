const { test, expect } = require("@playwright/test");

async function openEditor(page) {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  await page.goto("/challenge/1_vector_add");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("solve");
}

test("highlights CUDA and provides API completion with real tab indentation", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator(".cm-content .cm-line span").first()).toBeVisible();
  await expect.poll(() => page.locator(".cm-content .cm-line span").evaluateAll((tokens) =>
    new Set(tokens.map((token) => getComputedStyle(token).color)).size
  )).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: "/tmp/kernelyard-editor-desktop.png", fullPage: true });

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("__glo");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("__global__");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => window.KernelEditor.getValue())).toBe("\t__glo");

});

test("switches to Triton completion and remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await page.getByRole("button", { name: "Triton", exact: true }).click();
  await expect(page.locator("#fileName")).toHaveText("solution.py");

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("tl.lo");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("tl.load");
  await expect(page.locator("#workspaceDivider")).toBeHidden();
  await expect(page.locator("#consoleDivider")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: "/tmp/kernelyard-editor-mobile.png", fullPage: true });
});

test("loads challenge 6 without mixing legacy editor assets", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

  const response = await page.goto("/challenge/6_softmax_attention");
  expect(response.headers()["cache-control"]).toContain("no-cache");
  await expect(page.locator('script[src^="/challenge.js?v="]')).toHaveCount(1);
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#problemTitle")).not.toHaveText("无法加载题目");
  await expect(page.locator(".cm-content")).toContainText("solve");
  expect(pageErrors).toEqual([]);
});

test("resizes all three workspace panes and persists their dimensions", async ({ page }) => {
  await openEditor(page);
  const problemPane = page.locator(".problem-pane");
  const consolePane = page.locator(".console");
  const vertical = page.locator("#workspaceDivider");
  const horizontal = page.locator("#consoleDivider");
  const initialProblemWidth = (await problemPane.boundingBox()).width;
  const initialConsoleHeight = (await consolePane.boundingBox()).height;

  const verticalBox = await vertical.boundingBox();
  await page.mouse.move(verticalBox.x + verticalBox.width / 2, verticalBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(verticalBox.x + 120, verticalBox.y + 180, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await problemPane.boundingBox()).width).toBeGreaterThan(initialProblemWidth + 90);

  const horizontalBox = await horizontal.boundingBox();
  await page.mouse.move(horizontalBox.x + 180, horizontalBox.y + horizontalBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(horizontalBox.x + 180, horizontalBox.y - 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await consolePane.boundingBox()).height).toBeGreaterThan(initialConsoleHeight + 40);

  const resizedProblemWidth = (await problemPane.boundingBox()).width;
  const resizedConsoleHeight = (await consolePane.boundingBox()).height;
  await page.screenshot({ path: "/tmp/kernelyard-resized-panes.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect.poll(async () => (await problemPane.boundingBox()).width).toBeCloseTo(resizedProblemWidth, 0);
  await expect.poll(async () => (await consolePane.boundingBox()).height).toBeCloseTo(resizedConsoleHeight, 0);
  await expect.poll(() => page.evaluate(() => ({
    problem: localStorage.getItem("kernel-layout:problem-width"),
    console: localStorage.getItem("kernel-layout:console-height"),
  }))).toEqual({ problem: String(Math.round(resizedProblemWidth)), console: String(Math.round(resizedConsoleHeight)) });
});

test("hides pane scrollbars without disabling scrolling", async ({ page }) => {
  await openEditor(page);
  const scrollbarStyles = await page.evaluate(() => ({
    problem: getComputedStyle(document.querySelector(".problem-pane")).scrollbarWidth,
    editor: getComputedStyle(document.querySelector(".cm-scroller")).scrollbarWidth,
    console: getComputedStyle(document.querySelector(".console pre")).scrollbarWidth,
  }));
  expect(scrollbarStyles).toEqual({ problem: "none", editor: "none", console: "none" });

  const problemPane = page.locator(".problem-pane");
  await problemPane.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => problemPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.evaluate(() => window.KernelEditor.setValue(
    Array.from({ length: 45 }, (_, index) => `int value_${index} = threadIdx.x + ${"blockIdx.x + ".repeat(14)}0;`).join("\n")
  ));
  const editorOverflow = await page.locator(".cm-scroller").evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight,
  }));
  expect(editorOverflow).toEqual({ horizontal: true, vertical: true });
  await page.screenshot({ path: "/tmp/kernelyard-hidden-scrollbars.png", fullPage: true });
});

test("distinguishes the active selection from matching identifiers", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => window.KernelEditor.setValue(
    "int threadsPerBlock = 256;\nint blocks = threadsPerBlock + threadsPerBlock;"
  ));
  const content = page.locator(".cm-content");
  await content.dblclick({ position: { x: 95, y: 28 } });
  const activeSelection = page.locator(".cm-selectionLayer .cm-selectionBackground").first();
  await expect(activeSelection).toBeVisible();
  await expect.poll(() => activeSelection.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(47, 111, 143)");
  await expect(page.locator(".cm-selectionMatch").first()).toBeVisible();
  await expect.poll(() => page.locator(".cm-selectionMatch").first().evaluate((element) =>
    getComputedStyle(element).backgroundColor
  )).toBe("rgba(216, 255, 62, 0.18)");
  await page.screenshot({ path: "/tmp/kernelyard-selection-colors.png", fullPage: true });
});
