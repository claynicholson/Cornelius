import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

const SOURCE_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".rb", ".swift", ".cs", ".php", ".dart", ".svelte", ".vue",
];

const SKIP_DIRS = [
  "node_modules/", "dist/", "build/", ".next/", "__pycache__/",
  "vendor/", "target/", ".git/", "coverage/",
];

interface QualityAnalysis {
  quality: "good" | "adequate" | "poor";
  confidence: number;
  reason: string;
  suggestions: string[];
}

export class CodeQualityCheck extends BaseCheck {
  id = "code_quality_overview";
  name = "Code Quality Overview";
  description = "AI assessment of code structure, effort, and originality.";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const sourceFiles = context.tree
      .filter((e) => e.type === "blob")
      .filter((e) => SOURCE_EXTENSIONS.some((ext) => e.path.toLowerCase().endsWith(ext)))
      .filter((e) => !SKIP_DIRS.some((dir) => e.path.includes(dir)));

    if (sourceFiles.length === 0) {
      return this.skip("No source code files to analyze", config);
    }

    if (!this.claude) {
      return this.heuristicCheck(sourceFiles, context, config);
    }

    try {
      // Pick up to 3 representative files (largest first, likely most substantial)
      const candidates = sourceFiles
        .filter((e) => e.size != null)
        .sort((a, b) => (b.size || 0) - (a.size || 0))
        .slice(0, 3);

      // If no size info, just take the first 3
      const toRead = candidates.length > 0 ? candidates : sourceFiles.slice(0, 3);

      const fileContents: string[] = [];
      for (const entry of toRead) {
        const content = await context.getFile(entry.path);
        if (content) {
          // Truncate very long files
          const truncated = content.length > 3000 ? content.slice(0, 3000) + "\n... (truncated)" : content;
          fileContents.push(`--- ${entry.path} ---\n${truncated}`);
        }
      }

      if (fileContents.length === 0) {
        return this.heuristicCheck(sourceFiles, context, config);
      }

      const analysis = await this.claude.askStructured<QualityAnalysis>(
        `You are reviewing a student software project for Hack Club. Assess the code quality based on these sample files.

Consider:
1. Does this look like original work (not just a tutorial copy-paste or boilerplate)?
2. Is there meaningful logic and structure?
3. Is the code reasonably organized?
4. Does it show real effort and learning?

Be encouraging but honest. Students are learning.

Return JSON:
{
  "quality": "good" | "adequate" | "poor",
  "confidence": number 0-1,
  "reason": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}`,
        fileContents.join("\n\n"),
      );

      const status =
        analysis.quality === "poor"
          ? "fail"
          : analysis.quality === "adequate"
            ? "warning"
            : "pass";

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
      return this.heuristicCheck(sourceFiles, context, config);
    }
  }

  private heuristicCheck(
    sourceFiles: { path: string }[],
    context: RepoContext,
    config: CheckConfig,
  ): CheckResult {
    const hasSrcDir = context.tree.some(
      (e) => e.type === "tree" && /^(src|app|lib|pkg|cmd)\/?$/i.test(e.path),
    );
    const hasTests = context.tree.some(
      (e) =>
        e.type === "blob" &&
        (/\.test\.|\.spec\.|_test\.|test_/i.test(e.path) ||
          /^tests?\//i.test(e.path)),
    );

    const score = sourceFiles.length + (hasSrcDir ? 5 : 0) + (hasTests ? 5 : 0);

    if (score >= 10) {
      return this.pass(
        `Project has ${sourceFiles.length} source files${hasSrcDir ? ", organized directory structure" : ""}${hasTests ? ", and tests" : ""}`,
        [],
        config,
      );
    }

    if (score >= 5) {
      return this.warn(
        `Project has ${sourceFiles.length} source files but could use more structure`,
        [],
        config,
      );
    }

    return this.warn(
      `Project appears minimal (${sourceFiles.length} source files, no clear structure)`,
      [],
      config,
    );
  }
}
