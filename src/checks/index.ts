import type { Check } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";
import { RepoAliveCheck } from "./repoAlive.js";
import { ReadmePresentCheck } from "./readmePresent.js";
import { ReadmeImagesCheck } from "./readmeImages.js";
import { ReadmeQualityCheck } from "./readmeQuality.js";
import { CadFilesCheck } from "./cadFiles.js";
import { PcbFilesCheck } from "./pcbFiles.js";
import { BomPresentCheck } from "./bomPresent.js";

export function createChecks(claude?: ClaudeClient): Check[] {
  return [
    new RepoAliveCheck(),
    new ReadmePresentCheck(),
    new ReadmeQualityCheck(claude),
    new ReadmeImagesCheck(claude),
    new CadFilesCheck(),
    new PcbFilesCheck(),
    new BomPresentCheck(),
  ];
}

export {
  RepoAliveCheck,
  ReadmePresentCheck,
  ReadmeImagesCheck,
  ReadmeQualityCheck,
  CadFilesCheck,
  PcbFilesCheck,
  BomPresentCheck,
};
