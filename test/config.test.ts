import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

describe("configuration", () => {
  it("uses defaults without a config file", () => {
    assert.deepEqual(loadConfig(join(tmpdir(), "pi-todos-missing.json")).config, DEFAULT_CONFIG);
  });

  it("reads valid overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-todos-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ completedInList: 0, completedInOverlay: 2, maxOverlayLines: 8, settleReminder: false }));
    assert.deepEqual(loadConfig(path).config, { completedInList: 0, completedInOverlay: 2, maxOverlayLines: 8, settleReminder: false });
  });

  it("falls back safely for malformed config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-todos-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "not json");
    const result = loadConfig(path);
    assert.deepEqual(result.config, DEFAULT_CONFIG);
    assert.match(result.warning!, /using defaults/);
  });

  it("warns about invalid values and preserves valid overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-todos-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ completedInList: 7, maxOverlayLines: 1, settleReminder: "yes" }));
    const result = loadConfig(path);
    assert.equal(result.config.completedInList, 7);
    assert.equal(result.config.maxOverlayLines, DEFAULT_CONFIG.maxOverlayLines);
    assert.equal(result.config.settleReminder, DEFAULT_CONFIG.settleReminder);
    assert.match(result.warning!, /invalid fields/);
  });
});
