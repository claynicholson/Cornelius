import type { Check } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";
import { RepoAliveCheck } from "./repoAlive.js";
import { ReadmePresentCheck } from "./readmePresent.js";
import { ReadmeImagesCheck } from "./readmeImages.js";
import { ReadmeQualityCheck } from "./readmeQuality.js";
import { CadFilesCheck } from "./cadFiles.js";
import { PcbFilesCheck } from "./pcbFiles.js";
import { BomPresentCheck } from "./bomPresent.js";
import { SourceCodeCheck } from "./sourceCode.js";
import { GitignoreCheck } from "./gitignorePresent.js";
import { PackageManagerCheck } from "./packageManager.js";
import { LicensePresentCheck } from "./licensePresent.js";
import { CodeQualityCheck } from "./codeQuality.js";
import { UrlAliveCheck } from "./urlAlive.js";
import { DeepCodeReviewCheck } from "./deepCodeReview.js";

export function createChecks(claude?: ClaudeClient): Check[] {
  return [
    new RepoAliveCheck(),
    new ReadmePresentCheck(),
    new ReadmeQualityCheck(claude),
    new ReadmeImagesCheck(claude),
    new CadFilesCheck(),
    new PcbFilesCheck(),
    new BomPresentCheck(),
    new SourceCodeCheck(),
    new GitignoreCheck(),
    new PackageManagerCheck(),
    new LicensePresentCheck(),
    new CodeQualityCheck(claude),
    new UrlAliveCheck(claude),
    new DeepCodeReviewCheck(claude),
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
  SourceCodeCheck,
  GitignoreCheck,
  PackageManagerCheck,
  LicensePresentCheck,
  CodeQualityCheck,
  UrlAliveCheck,
  DeepCodeReviewCheck,
};
