import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext, TreeEntry } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

const SOURCE_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".rb", ".swift", ".cs", ".php", ".dart", ".svelte", ".vue",
];

const SKIP_DIRS = [
  "node_modules/", "dist/", "build/", ".next/", "__pycache__/",
  "vendor/", "target/", ".git/", "coverage/", ".cache/", ".nuxt/",
  ".output/", "out/", ".svelte-kit/",
];

// ── Heuristic signal detectors ─────────────────────────────

interface HeuristicSignal {
  name: string;
  weight: number; // 0-1, how strongly this indicates AI generation
  detail: string;
}

/**
 * Measures comment density in source code.
 * AI-generated code tends to have excessive commenting (>30% lines are comments).
 */
function analyzeCommentDensity(content: string, path: string): HeuristicSignal | null {
  const lines = content.split("\n");
  if (lines.length < 10) return null;

  let commentLines = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      commentLines++;
      if (!trimmed.includes("*/")) inBlockComment = false;
      inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("\"\"\"") || trimmed.startsWith("'''")) {
      commentLines++;
    }
  }

  const codeLines = lines.filter((l) => l.trim().length > 0).length;
  if (codeLines === 0) return null;

  const commentRatio = commentLines / codeLines;

  if (commentRatio > 0.4) {
    return {
      name: "excessive_comments",
      weight: 0.6,
      detail: `${path}: ${(commentRatio * 100).toFixed(0)}% of lines are comments (${commentLines}/${codeLines}) - unusually high for student code`,
    };
  }

  if (commentRatio > 0.3) {
    return {
      name: "high_comments",
      weight: 0.3,
      detail: `${path}: ${(commentRatio * 100).toFixed(0)}% comment lines - higher than typical student projects`,
    };
  }

  return null;
}

/**
 * Detects uniform JSDoc / docstring patterns across a file.
 * AI tends to document every function with the same structure.
 */
function analyzeDocstringPattern(content: string, path: string): HeuristicSignal | null {
  // Count function-like declarations and JSDoc/docstring blocks
  const functionPattern = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>|def\s+\w+|fn\s+\w+|func\s+\w+|(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?\w+\s*\()/g;
  const jsdocPattern = /\/\*\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|\/\/\/\s/g;

  const functions = content.match(functionPattern) || [];
  const docstrings = content.match(jsdocPattern) || [];

  if (functions.length >= 4 && docstrings.length >= functions.length * 0.8) {
    return {
      name: "uniform_docstrings",
      weight: 0.5,
      detail: `${path}: ${docstrings.length} docstrings for ${functions.length} functions - every function documented (uncommon in student projects)`,
    };
  }

  return null;
}

/**
 * Detects overly verbose/self-explanatory variable names.
 * AI tends to use names like `userAuthenticationToken` instead of `authToken`.
 */
function analyzeVerboseNaming(content: string, path: string): HeuristicSignal | null {
  // Find camelCase/snake_case identifiers with 4+ words
  const longNamePattern = /(?:(?:[a-z]+[A-Z]){3,}[a-z]*|(?:[a-z]+_){3,}[a-z]+)/g;
  const matches = content.match(longNamePattern) || [];

  // Filter out common long but legitimate names
  const filtered = matches.filter((m) => {
    const lower = m.toLowerCase();
    return (
      !lower.includes("addeventlistener") &&
      !lower.includes("createelement") &&
      !lower.includes("getelementby") &&
      !lower.includes("queryselector") &&
      !lower.includes("preventdefault") &&
      !lower.includes("stoppropagation") &&
      !lower.includes("classname") &&
      m.length > 25
    );
  });

  if (filtered.length >= 5) {
    const examples = filtered.slice(0, 3).join(", ");
    return {
      name: "verbose_naming",
      weight: 0.3,
      detail: `${path}: ${filtered.length} excessively verbose identifiers (e.g. ${examples})`,
    };
  }

  return null;
}

/**
 * Detects suspiciously perfect error handling.
 * Student code typically has sparse error handling.
 */
function analyzePerfectErrorHandling(content: string, path: string): HeuristicSignal | null {
  const tryBlocks = (content.match(/\btry\s*\{/g) || []).length;
  const catchBlocks = (content.match(/\bcatch\s*\(/g) || []).length;
  const lines = content.split("\n").filter((l) => l.trim().length > 0).length;

  if (lines < 30) return null;

  // More than 1 try-catch per 20 lines of code is suspicious for student work
  const errorDensity = tryBlocks / (lines / 20);

  if (errorDensity > 1.5 && tryBlocks >= 4) {
    return {
      name: "perfect_error_handling",
      weight: 0.4,
      detail: `${path}: ${tryBlocks} try-catch blocks in ${lines} lines - unusually thorough error handling for a student project`,
    };
  }

  return null;
}

/**
 * Checks for suspiciously uniform file sizes across source files.
 */
function analyzeUniformFileSizes(files: TreeEntry[]): HeuristicSignal | null {
  const withSize = files.filter((f) => f.size != null && f.size > 100);
  if (withSize.length < 5) return null;

  const sizes = withSize.map((f) => f.size!);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const variance = sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length;
  const stdDev = Math.sqrt(variance);
  const coeffOfVariation = stdDev / mean;

  // Very low coefficient of variation means suspiciously uniform sizes
  if (coeffOfVariation < 0.2 && withSize.length >= 5) {
    return {
      name: "uniform_file_sizes",
      weight: 0.35,
      detail: `${withSize.length} source files have suspiciously uniform sizes (CV: ${(coeffOfVariation * 100).toFixed(1)}%, mean: ${Math.round(mean)} bytes)`,
    };
  }

  return null;
}

/**
 * Detects repeated identical comment patterns across files.
 */
function analyzeCommentPatternConsistency(
  fileContents: Array<{ path: string; content: string }>,
): HeuristicSignal | null {
  if (fileContents.length < 3) return null;

  // Extract comment patterns from each file
  const commentStyles: string[] = [];
  for (const { content } of fileContents) {
    const comments = content.match(/\/\*\*[\s\S]*?\*\//g) || [];
    if (comments.length >= 2) {
      // Normalize: strip content, keep structure
      const structures = comments.map((c) =>
        c.replace(/[a-zA-Z0-9]+/g, "X").replace(/\s+/g, " "),
      );
      commentStyles.push(structures.join("|"));
    }
  }

  if (commentStyles.length < 2) return null;

  // Check if comment structures are nearly identical across files
  let sameStructureCount = 0;
  for (let i = 1; i < commentStyles.length; i++) {
    if (commentStyles[i] === commentStyles[0]) {
      sameStructureCount++;
    }
  }

  const consistencyRatio = sameStructureCount / (commentStyles.length - 1);

  if (consistencyRatio > 0.7 && commentStyles.length >= 3) {
    return {
      name: "identical_comment_patterns",
      weight: 0.5,
      detail: `${sameStructureCount + 1}/${commentStyles.length} files share identical comment structure patterns`,
    };
  }

  return null;
}

// ── AI analysis response type ──────────────────────────────

interface AiDetectionAnalysis {
  probability: number; // 0-1
  confidence: number; // 0-1
  signals: string[];
  reasoning: string;
}

const AI_DETECTION_PROMPT = `You are analyzing code samples from a student project submission for Hack Club. Your task is to assess the probability that this code was primarily AI-generated (e.g., by ChatGPT, Claude, Copilot, etc.) rather than written by a student.

Look for these patterns:
1. Overly polished code structure uncommon in student projects
2. Perfectly consistent formatting and naming conventions across all files
3. Comprehensive error handling everywhere (students usually skip this)
4. Generic, tutorial-like code that explains itself through comments
5. Lack of debugging artifacts (console.log, TODO comments, commented-out code)
6. Suspiciously perfect project structure with no rough edges
7. Code that reads like documentation rather than working software
8. Every edge case handled, every function documented

Also consider counter-signals (things that suggest human authorship):
1. Inconsistent style between files
2. Debug/log statements left in
3. TODO or FIXME comments
4. Commented-out code blocks
5. Informal or personal comments
6. Variable naming inconsistencies
7. Some functions well-documented while others have no comments
8. Evidence of iterative development (partial features, workarounds)

IMPORTANT: This is probabilistic. Many students write good code. Having clean code alone is NOT proof of AI generation. Look for the COMBINATION of signals. Be fair and err on the side of caution.

Return JSON:
{
  "probability": number 0-1 (probability code is primarily AI-generated),
  "confidence": number 0-1 (how confident you are in your assessment),
  "signals": ["signal1", "signal2"],
  "reasoning": "2-3 sentence explanation"
}`;

export class AiCodeDetectionCheck extends BaseCheck {
  id = "ai_code_detection";
  name = "AI-Generated Code Detection";
  description = "Detects signs of AI-generated or heavily AI-assisted code using heuristics and AI analysis.";

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

    const signals: HeuristicSignal[] = [];
    const evidence: string[] = [];

    // ── Phase 1: Heuristic analysis ────────────────────────

    // Select representative files to read (up to 6)
    const candidates = [...sourceFiles]
      .filter((e) => e.size != null)
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 6);

    const toRead = candidates.length > 0 ? candidates : sourceFiles.slice(0, 6);

    const fileContents: Array<{ path: string; content: string }> = [];
    for (const entry of toRead) {
      try {
        const content = await context.getFile(entry.path);
        if (content && content.length > 50) {
          const truncated = content.length > 5000 ? content.slice(0, 5000) : content;
          fileContents.push({ path: entry.path, content: truncated });
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (fileContents.length === 0) {
      return this.skip("Could not read any source files for analysis", config);
    }

    // Run heuristic detectors on each file
    for (const { path, content } of fileContents) {
      const commentSignal = analyzeCommentDensity(content, path);
      if (commentSignal) signals.push(commentSignal);

      const docstringSignal = analyzeDocstringPattern(content, path);
      if (docstringSignal) signals.push(docstringSignal);

      const namingSignal = analyzeVerboseNaming(content, path);
      if (namingSignal) signals.push(namingSignal);

      const errorSignal = analyzePerfectErrorHandling(content, path);
      if (errorSignal) signals.push(errorSignal);
    }

    // Cross-file analysis
    const fileSizeSignal = analyzeUniformFileSizes(sourceFiles);
    if (fileSizeSignal) signals.push(fileSizeSignal);

    const commentPatternSignal = analyzeCommentPatternConsistency(fileContents);
    if (commentPatternSignal) signals.push(commentPatternSignal);

    // Calculate heuristic probability
    let heuristicProbability = 0;
    if (signals.length > 0) {
      const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
      const maxPossibleWeight = signals.length * 0.6; // normalize against reasonable max
      heuristicProbability = Math.min(1, totalWeight / Math.max(maxPossibleWeight, 1));
    }

    for (const signal of signals) {
      evidence.push(`[Heuristic] ${signal.detail}`);
    }

    evidence.push(`Heuristic signal count: ${signals.length}, weighted probability: ${(heuristicProbability * 100).toFixed(0)}%`);

    // ── Phase 2: AI-powered analysis (if available) ────────

    let aiProbability: number | null = null;
    let aiConfidence = 0;

    if (this.claude) {
      try {
        const sampledContent = fileContents
          .slice(0, 4)
          .map(({ path, content }) => `--- ${path} ---\n${content}`)
          .join("\n\n");

        const prompt = (config.prompt as string) || AI_DETECTION_PROMPT;
        const analysis = await this.claude.askStructured<AiDetectionAnalysis>(
          prompt,
          sampledContent,
          1024,
        );

        aiProbability = Math.max(0, Math.min(1, analysis.probability));
        aiConfidence = Math.max(0, Math.min(1, analysis.confidence));

        evidence.push(`[AI Analysis] Probability: ${(aiProbability * 100).toFixed(0)}% (confidence: ${(aiConfidence * 100).toFixed(0)}%)`);
        evidence.push(`[AI Analysis] ${analysis.reasoning}`);
        for (const signal of analysis.signals) {
          evidence.push(`[AI Signal] ${signal}`);
        }
      } catch {
        evidence.push("[AI Analysis] Failed - falling back to heuristics only");
      }
    }

    // ── Phase 3: Combined scoring ──────────────────────────

    let finalProbability: number;
    let finalConfidence: number;
    let usedAi = false;

    if (aiProbability !== null) {
      // Weighted average: AI analysis gets more weight since it's more nuanced
      finalProbability = aiProbability * 0.7 + heuristicProbability * 0.3;
      finalConfidence = aiConfidence * 0.7 + (signals.length >= 3 ? 0.7 : 0.4) * 0.3;
      usedAi = true;
    } else {
      finalProbability = heuristicProbability;
      // Heuristics alone have lower confidence
      finalConfidence = signals.length >= 4 ? 0.6 : signals.length >= 2 ? 0.4 : 0.3;
    }

    evidence.push(`Final AI-generation probability: ${(finalProbability * 100).toFixed(0)}%`);

    // ── Decision ───────────────────────────────────────────

    // High threshold - we do not want false accusations
    if (finalProbability >= 0.75) {
      return {
        checkName: this.id,
        required: config.required,
        status: config.severity === "warning" ? "warning" : "fail",
        confidence: finalConfidence,
        evidence,
        reason: `Code shows strong indicators of being primarily AI-generated (probability: ${(finalProbability * 100).toFixed(0)}%). This is a probabilistic assessment - manual review recommended.`,
        aiUsed: usedAi,
      };
    }

    if (finalProbability >= 0.5) {
      return {
        checkName: this.id,
        required: config.required ?? false,
        status: "warning",
        confidence: finalConfidence,
        evidence,
        reason: `Code shows moderate indicators of AI assistance (probability: ${(finalProbability * 100).toFixed(0)}%). Some AI use may be present but could also be a well-structured student project.`,
        aiUsed: usedAi,
      };
    }

    return {
      checkName: this.id,
      required: config.required,
      status: "pass",
      confidence: finalConfidence,
      evidence,
      reason: `Code does not show strong indicators of AI generation (probability: ${(finalProbability * 100).toFixed(0)}%). Appears to be student-authored.`,
      aiUsed: usedAi,
    };
  }
}
