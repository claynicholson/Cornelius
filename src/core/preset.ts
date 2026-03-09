import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { PresetConfig, CheckConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = resolve(__dirname, "../../presets");

const DEFAULT_CHECK_CONFIG: CheckConfig = {
  enabled: true,
  required: true,
};

export function loadPreset(name: string): PresetConfig {
  const presetPath = resolve(PRESETS_DIR, `${name}.json`);

  if (!existsSync(presetPath)) {
    throw new Error(`Preset "${name}" not found at ${presetPath}`);
  }

  const raw = readFileSync(presetPath, "utf-8");
  return JSON.parse(raw) as PresetConfig;
}

export function getCheckConfig(
  preset: PresetConfig,
  checkId: string
): CheckConfig {
  const checkConf = preset.checks[checkId];
  if (!checkConf) {
    return { ...DEFAULT_CHECK_CONFIG };
  }
  return { ...DEFAULT_CHECK_CONFIG, ...checkConf };
}

export function listPresets(): string[] {
  const fs = require("fs");
  if (!existsSync(PRESETS_DIR)) return [];

  return fs
    .readdirSync(PRESETS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""));
}
