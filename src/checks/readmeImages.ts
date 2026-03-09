import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HTML_IMG_REGEX = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi;

interface ImageAnalysis {
  hasProjectImage: boolean;
  confidence: number;
  reason: string;
}

export class ReadmeImagesCheck extends BaseCheck {
  id = "readme_has_project_image";
  name = "README Has Project Image";
  description = "Checks that the README includes at least one project image.";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    if (!context.readme) {
      return this.fail("No README content available to check for images", [], config);
    }

    const mdImages = [...context.readme.matchAll(MD_IMAGE_REGEX)].map(
      (m) => m[2]
    );
    const htmlImages = [...context.readme.matchAll(HTML_IMG_REGEX)].map(
      (m) => m[1]
    );
    const allImages = [...mdImages, ...htmlImages];

    if (allImages.length === 0) {
      return this.fail(
        "No images found in README",
        [],
        config
      );
    }

    if (this.claude) {
      try {
        const analysis = await this.claude.askStructured<ImageAnalysis>(
          `Analyze this README and determine if it contains at least one image that appears to be a project image (photo of the hardware, 3D render, PCB render, schematic screenshot, etc).

Return JSON: {"hasProjectImage": boolean, "confidence": number 0-1, "reason": "explanation"}`,
          context.readme
        );

        const result: CheckResult = {
          checkName: this.id,
          required: config.required,
          status: analysis.hasProjectImage ? "pass" : "fail",
          confidence: analysis.confidence,
          evidence: allImages.slice(0, 5),
          reason: analysis.reason,
          aiUsed: true,
        };
        return result;
      } catch {
        // Fall back to rule-based
      }
    }

    return this.pass(
      `Found ${allImages.length} image(s) in README`,
      allImages.slice(0, 5),
      config
    );
  }
}
