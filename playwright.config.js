const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:18731",
    headless: true,
  },
  webServer: {
    command: ".venv/bin/python app.py",
    env: { LEETGPU_HOST: "127.0.0.1", LEETGPU_PORT: "18731" },
    port: 18731,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
