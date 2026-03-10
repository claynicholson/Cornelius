import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

const SOURCE_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".rb", ".swift", ".cs", ".php", ".dart", ".svelte", ".vue",
  ".html", ".css", ".scss", ".sass", ".less",
];

const SKIP_DIRS = [
  "node_modules/", "dist/", "build/", ".next/", "__pycache__/",
  "vendor/", "target/", ".git/", "coverage/", ".cache/", ".nuxt/",
  ".output/", "out/", ".svelte-kit/",
];

/** Entry point file names to prioritize */
const ENTRY_POINTS = [
  "index.ts", "index.js", "index.tsx", "index.jsx",
  "main.ts", "main.js", "main.py", "main.go", "main.rs",
  "app.ts", "app.js", "app.tsx", "app.jsx", "app.py",
  "server.ts", "server.js", "server.py",
  "mod.rs", "lib.rs",
];

/** Config files that provide architecture context */
const CONFIG_FILES = [
  "package.json", "tsconfig.json", "next.config.js", "next.config.ts",
  "vite.config.ts", "vite.config.js", "nuxt.config.ts",
  "svelte.config.js", "astro.config.mjs",
  "requirements.txt", "pyproject.toml", "Cargo.toml", "go.mod",
  "docker-compose.yml", "Dockerfile", ".env.example",
  "vercel.json", "netlify.toml", "fly.toml", "railway.json",
];

interface DeepReviewAnalysis {
  isOriginal: boolean;
  isShipped: boolean;
  complexity: "simple" | "medium" | "complex";
  featureCount: number;
  architectureDescription: string;
  confidence: number;
  reason: string;
  redFlags: string[];
  strengths: string[];
}

const DEFAULT_PROMPT = `You are a senior reviewer for Hack Club's YSWS (You Ship, We Ship) program. You are performing a deep code review of a student's software project to determine if it is a genuinely shipped, original piece of work.

Analyze the provided source code files, repository file tree, and README carefully.

Evaluate the following:

1. **Originality**: Is this original work by the student, or is it a cloned template, tutorial copy-paste, or fork with minimal changes?
2. **Shipped Status**: Does this project appear to be a real, functional, deployed application?
3. **Architecture & Complexity**: What is the overall architecture? How many distinct features are implemented?
4. **Effort & Iteration**: Does the code show real effort? Multiple components working together?
5. **Red Flags**: Framework starter with no custom code, tutorial copy-paste, trivially small codebase claiming many hours

Return JSON:
{
  "isOriginal": boolean,
  "isShipped": boolean,
  "complexity": "simple" | "medium" | "complex",
  "featureCount": number,
  "architectureDescription": "brief description of the project architecture",
  "confidence": number 0-1,
  "reason": "2-3 sentence explanation of your assessment",
  "redFlags": ["flag1", "flag2"],
  "strengths": ["strength1", "strength2"]
}`;

export class DeepCodeReviewCheck extends BaseCheck {
  id = "deep_code_review";
  name = "Deep Code Review";
  description = "Deep AI-powered code review assessing originality, shipped status, and code quality (~$0.50 budget).";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    if (!this.claude) {
      return this.skip("Deep code review requires AI (Claude API key)", config);
    }

    const allFiles = context.tree
      .filter((e) => e.type === "blob")
      .filter((e) => !SKIP_DIRS.some((dir) => e.path.includes(dir)));

    const sourceFiles = allFiles
      .filter((e) => SOURCE_EXTENSIONS.some((ext) => e.path.toLowerCase().endsWith(ext)));

    if (sourceFiles.length === 0) {
      return this.fail("No source code files found to review", [], config);
    }

    try {
      // 1. Select files to read (up to 20, prioritized)
      const filesToRead = this.selectFiles(sourceFiles, allFiles);

      // 2. Read file contents
      const fileContents: string[] = [];
      for (const filePath of filesToRead) {
        const content = await context.getFile(filePath);
        if (content) {
          const truncated = content.length > 6000
            ? content.slice(0, 6000) + "\n... (truncated)"
            : content;
          fileContents.push(`--- ${filePath} ---\n${truncated}`);
        }
      }

      if (fileContents.length === 0) {
        return this.fail("Could not read any source files", [], config);
      }

      // 3. Read config files for architecture context
      const configContents: string[] = [];
      for (const configFile of CONFIG_FILES) {
        const match = allFiles.find((f) => f.path.toLowerCase() === configFile.toLowerCase()
          || f.path.toLowerCase().endsWith(`/${configFile.toLowerCase()}`));
        if (match) {
          const content = await context.getFile(match.path);
          if (content) {
            const truncated = content.length > 2000
              ? content.slice(0, 2000) + "\n... (truncated)"
              : content;
            configContents.push(`--- ${match.path} ---\n${truncated}`);
          }
        }
      }

      // 4. Build the full context for Claude
      const treeList = context.tree
        .filter((e) => !SKIP_DIRS.some((dir) => e.path.includes(dir)))
        .map((e) => `${e.type === "tree" ? "📁" : "📄"} ${e.path}`)
        .join("\n");

      const fullContext = [
        `=== REPOSITORY FILE TREE (${context.tree.length} total files) ===`,
        treeList,
        "",
        context.readme ? `=== README ===\n${context.readme.slice(0, 3000)}` : "=== NO README ===",
        "",
        configContents.length > 0 ? `=== CONFIG FILES ===\n${configContents.join("\n\n")}` : "",
        "",
        `=== SOURCE CODE (${fileContents.length} files sampled) ===`,
        fileContents.join("\n\n"),
      ].join("\n");

      // 5. Call Claude with the deep review prompt
      const prompt = (config.prompt as string) || DEFAULT_PROMPT;
      const analysis = await this.claude.askStructured<DeepReviewAnalysis>(
        prompt,
        fullContext,
        2048 // larger output for detailed analysis
      );

      // 6. Map to check result
      const evidence = [
        ...analysis.strengths.map((s) => `✓ ${s}`),
        ...analysis.redFlags.map((f) => `⚠ ${f}`),
        `Architecture: ${analysis.architectureDescription}`,
        `Complexity: ${analysis.complexity}`,
        `Features: ${analysis.featureCount}`,
      ];

      let status: "pass" | "fail" | "warning";
      if (analysis.isShipped && analysis.isOriginal) {
        status = "pass";
      } else if (analysis.isOriginal && !analysis.isShipped) {
        status = "warning";
      } else {
        status = "fail";
      }

      return {
        checkName: this.id,
        required: config.required,
        status: config.severity === "warning" && status === "fail" ? "warning" : status,
        confidence: analysis.confidence,
        evidence,
        reason: analysis.reason,
        aiUsed: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`Deep code review failed: ${message}`, config);
    }
  }

  /** Select up to 20 files, prioritizing entry points, then largest files, then breadth */
  private selectFiles(
    sourceFiles: { path: string; size?: number }[],
    _allFiles: { path: string; size?: number }[]
  ): string[] {
    const selected = new Set<string>();
    const MAX_FILES = 20;

    // 1. Entry points first
    for (const entry of ENTRY_POINTS) {
      if (selected.size >= MAX_FILES) break;
      const match = sourceFiles.find(
        (f) => f.path.toLowerCase().endsWith(`/${entry}`) || f.path.toLowerCase() === entry
      );
      if (match) selected.add(match.path);
    }

    // 2. Largest files (most substantial code)
    const bySize = [...sourceFiles]
      .filter((f) => f.size != null && !selected.has(f.path))
      .sort((a, b) => (b.size || 0) - (a.size || 0));

    for (const file of bySize) {
      if (selected.size >= MAX_FILES) break;
      selected.add(file.path);
    }

    // 3. Fill remaining with breadth across directories
    const dirs = new Set<string>();
    for (const file of sourceFiles) {
      if (selected.size >= MAX_FILES) break;
      if (selected.has(file.path)) continue;

      const dir = file.path.includes("/")
        ? file.path.substring(0, file.path.lastIndexOf("/"))
        : ".";

      if (!dirs.has(dir)) {
        dirs.add(dir);
        selected.add(file.path);
      }
    }

    return [...selected];
  }
}
