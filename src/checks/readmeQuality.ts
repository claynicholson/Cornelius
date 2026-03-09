import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

interface QualityAnalysis {
  quality: "good" | "adequate" | "poor";
  hasDescription: boolean;
  hasInstructions: boolean;
  confidence: number;
  reason: string;
  suggestions: string[];
}

export class ReadmeQualityCheck extends BaseCheck {
  id = "readme_quality";
  name = "README Quality";
  description = "Uses AI to assess README quality and completeness.";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    if (!context.readme) {
      return this.fail("No README content available", [], config);
    }

    if (!this.claude) {
      // Basic heuristic: check length and structure
      const lines = context.readme.split("\n");
      const headings = lines.filter((l) => l.startsWith("#")).length;
      const wordCount = context.readme.split(/\s+/).length;

      if (wordCount < 50) {
        return this.warn(
          "README appears too short (less than 50 words)",
          [`${wordCount} words, ${headings} headings`],
          config
        );
      }

      return this.pass(
        `README has ${wordCount} words and ${headings} heading(s)`,
        [],
        config
      );
    }

    try {
      const analysis = await this.claude.askStructured<QualityAnalysis>(
        `Analyze this hardware project README for quality. Check if it:
1. Has a clear project description
2. Explains what the project does and why
3. Has build/assembly instructions or links to them
4. Is well-structured with headings

Return JSON:
{
  "quality": "good" | "adequate" | "poor",
  "hasDescription": boolean,
  "hasInstructions": boolean,
  "confidence": number 0-1,
  "reason": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}`,
        context.readme
      );

      const status = analysis.quality === "poor" ? "fail" : analysis.quality === "adequate" ? "warning" : "pass";

      return {
        checkName: this.id,
        required: config.required,
        status: config.severity === "warning" && status === "fail" ? "warning" : status,
        confidence: analysis.confidence,
        evidence: analysis.suggestions,
        reason: analysis.reason,
        aiUsed: true,
      };
    } catch {
      return this.warn("AI analysis failed, falling back to basic check", [], config);
    }
  }
}
