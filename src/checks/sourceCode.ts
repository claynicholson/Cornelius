import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

const SOURCE_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".py", ".pyw",
  ".go",
  ".rs",
  ".java", ".kt", ".kts", ".scala",
  ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp",
  ".rb",
  ".swift",
  ".cs",
  ".php",
  ".dart",
  ".lua",
  ".zig",
  ".nim",
  ".ex", ".exs",
  ".hs",
  ".ml", ".mli",
  ".svelte", ".vue",
  ".sh", ".bash", ".zsh",
];

export class SourceCodeCheck extends BaseCheck {
  id = "source_code_present";
  name = "Source Code Present";
  description = "Checks that the repository contains actual source code files.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const sourceFiles = this.findFiles(context.tree, SOURCE_EXTENSIONS);
    const minCount = (config.minimum_file_count as number) || 3;

    if (sourceFiles.length === 0) {
      return this.fail("No source code files found in the repository", [], config);
    }

    // Detect languages
    const extCounts = new Map<string, number>();
    for (const f of sourceFiles) {
      const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
    }
    const topLangs = [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ext, count]) => `${ext} (${count})`);

    if (sourceFiles.length < minCount) {
      return this.warn(
        `Only ${sourceFiles.length} source file(s) found (minimum ${minCount} recommended)`,
        topLangs,
        config,
      );
    }

    return this.pass(
      `Found ${sourceFiles.length} source code files`,
      topLangs,
      config,
    );
  }
}
