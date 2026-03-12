import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext, TreeEntry } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

const SOURCE_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".rb", ".swift", ".cs", ".php", ".dart", ".svelte", ".vue",
  ".html", ".css", ".scss", ".sass", ".less",
];

const SKIP_DIRS = [
  "node_modules/", "dist/", "build/", ".next/", "__pycache__/",
  "vendor/", "target/", ".git/", "coverage/", ".cache/", ".nuxt/",
  ".output/", "out/", ".svelte-kit/", ".expo/",
];

const CONFIG_EXTENSIONS = [
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".lock", ".config.js", ".config.ts", ".config.mjs",
];

const GENERATED_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.generated\./,
  /\.g\.dart$/,
  /swagger\.(json|yaml)$/,
];

// ── Package manager parsers ────────────────────────────────

interface DependencyInfo {
  declared: string[];
  devDeclared: string[];
}

function parsePackageJsonDeps(content: string): DependencyInfo {
  try {
    const pkg = JSON.parse(content);
    return {
      declared: Object.keys(pkg.dependencies || {}),
      devDeclared: Object.keys(pkg.devDependencies || {}),
    };
  } catch {
    return { declared: [], devDeclared: [] };
  }
}

function parseRequirementsTxt(content: string): DependencyInfo {
  const lines = content.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[>=<!\[;]/)[0].trim())
    .filter(Boolean);
  return { declared: lines, devDeclared: [] };
}

// ── Import extraction ──────────────────────────────────────

function extractImports(content: string, path: string): string[] {
  const imports = new Set<string>();

  // JS/TS: import ... from "pkg" or require("pkg")
  const jsImports = content.matchAll(/(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"./][^'"]*)['"]/g);
  for (const m of jsImports) {
    // Get the package name (first segment for scoped packages)
    const pkg = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
    imports.add(pkg);
  }

  // Python: import pkg / from pkg import ...
  if (path.endsWith(".py")) {
    const pyImports = content.matchAll(/(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
    for (const m of pyImports) {
      imports.add(m[1]);
    }
  }

  // Go: import "pkg"
  if (path.endsWith(".go")) {
    const goImports = content.matchAll(/import\s+(?:\(\s*)?["']([^"']+)["']/g);
    for (const m of goImports) {
      imports.add(m[1]);
    }
  }

  // Rust: use pkg::
  if (path.endsWith(".rs")) {
    const rsImports = content.matchAll(/\buse\s+([a-zA-Z_][a-zA-Z0-9_]*)::/g);
    for (const m of rsImports) {
      if (m[1] !== "std" && m[1] !== "self" && m[1] !== "super" && m[1] !== "crate") {
        imports.add(m[1]);
      }
    }
  }

  return [...imports];
}

// ── Code metrics ───────────────────────────────────────────

interface CodeMetrics {
  totalSourceFiles: number;
  meaningfulSourceFiles: number;
  totalLinesOfCode: number;
  blankLines: number;
  commentLines: number;
  netCodeLines: number;
  uniqueImports: Set<string>;
  languageBreakdown: Map<string, number>;
  hasTests: boolean;
  testFileCount: number;
  hasCustomCss: boolean;
  hasDbSchemas: boolean;
  hasMigrations: boolean;
  hasEnvUsage: boolean;
  routeCount: number;
  componentCount: number;
}

function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /\.test\.|\.spec\.|_test\.|test_/i.test(lower) ||
    /^tests?\//i.test(lower) ||
    /\/__tests__\//i.test(lower) ||
    /^spec\//i.test(lower)
  );
}

function isGenerated(path: string): boolean {
  return GENERATED_PATTERNS.some((p) => p.test(path));
}

function isConfigFile(path: string): boolean {
  const filename = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
  return CONFIG_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));
}

function getLanguage(path: string): string | null {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java", ".kt": "Kotlin",
    ".c": "C", ".cpp": "C++", ".h": "C/C++",
    ".rb": "Ruby",
    ".swift": "Swift",
    ".cs": "C#",
    ".php": "PHP",
    ".dart": "Dart",
    ".svelte": "Svelte",
    ".vue": "Vue",
    ".html": "HTML",
    ".css": "CSS", ".scss": "SCSS", ".sass": "Sass", ".less": "Less",
  };
  return map[ext] || null;
}

function countCodeLines(content: string): { total: number; blank: number; comment: number; net: number } {
  const lines = content.split("\n");
  let blank = 0;
  let comment = 0;
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      blank++;
      continue;
    }
    if (inBlock) {
      comment++;
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      comment++;
      if (!trimmed.includes("*/")) inBlock = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
      comment++;
    }
  }

  return { total: lines.length, blank, comment, net: lines.length - blank - comment };
}

// ── Route / component counting from file tree ──────────────

function countRoutes(tree: TreeEntry[]): number {
  let count = 0;
  for (const e of tree) {
    if (e.type !== "blob") continue;
    const lower = e.path.toLowerCase();
    // Next.js pages/app router
    if (/pages\/(?!_|api\/).*\.(tsx?|jsx?|mdx?)$/.test(lower)) count++;
    if (/app\/.*\/page\.(tsx?|jsx?)$/.test(lower)) count++;
    // Express/API routes
    if (/routes?\/.*\.(ts|js)$/.test(lower)) count++;
    // Django urls.py
    if (/urls\.py$/.test(lower)) count++;
    // Flask
    if (lower.endsWith(".py") && lower.includes("route")) count++;
  }
  return count;
}

function countComponents(tree: TreeEntry[]): number {
  let count = 0;
  for (const e of tree) {
    if (e.type !== "blob") continue;
    const lower = e.path.toLowerCase();
    // React/Vue/Svelte components
    if (/components?\/.*\.(tsx?|jsx?|vue|svelte)$/.test(lower)) count++;
    // Generic component naming pattern
    if (/[A-Z][a-zA-Z]+\.(tsx|jsx)$/.test(e.path)) count++;
  }
  return count;
}

// ── Hour estimation ────────────────────────────────────────

interface HourEstimate {
  minHours: number;
  maxHours: number;
  bestGuess: number;
  justification: string;
}

function estimateHours(metrics: CodeMetrics): HourEstimate {
  // Base: ~30 lines of code per hour for a student (conservative)
  const baseLinesPerHour = 30;
  const baseHours = metrics.netCodeLines / baseLinesPerHour;

  // Complexity multipliers
  let multiplier = 1.0;

  // Multiple languages add learning overhead
  if (metrics.languageBreakdown.size > 1) {
    multiplier += (metrics.languageBreakdown.size - 1) * 0.15;
  }

  // Tests add effort
  if (metrics.hasTests) multiplier += 0.2;

  // Database work adds effort
  if (metrics.hasDbSchemas || metrics.hasMigrations) multiplier += 0.2;

  // Many components/routes means more architectural thinking
  if (metrics.routeCount > 5) multiplier += 0.15;
  if (metrics.componentCount > 10) multiplier += 0.15;

  // Custom CSS takes time
  if (metrics.hasCustomCss) multiplier += 0.1;

  const bestGuess = Math.round(baseHours * multiplier);
  const minHours = Math.max(1, Math.round(bestGuess * 0.5));
  const maxHours = Math.round(bestGuess * 2.0);

  const parts: string[] = [];
  parts.push(`${metrics.netCodeLines} net lines of code`);
  if (metrics.languageBreakdown.size > 1) {
    parts.push(`${metrics.languageBreakdown.size} languages`);
  }
  if (metrics.routeCount > 0) parts.push(`${metrics.routeCount} routes/pages`);
  if (metrics.componentCount > 0) parts.push(`${metrics.componentCount} components`);
  if (metrics.hasTests) parts.push("tests present");
  if (metrics.hasDbSchemas) parts.push("database schemas");

  return {
    minHours,
    maxHours,
    bestGuess,
    justification: `Based on ${parts.join(", ")} - estimated ${minHours}-${maxHours} hours (best guess: ${bestGuess}h)`,
  };
}

// ── AI consistency analysis ────────────────────────────────

interface ConsistencyAnalysis {
  readmeMatchesCode: boolean;
  unusedDependencies: string[];
  missingDependencies: string[];
  overallConsistency: "consistent" | "minor_issues" | "suspicious";
  findings: string[];
}

const CONSISTENCY_PROMPT = `You are reviewing a student project submission. Analyze the README, dependency list, and code samples for consistency.

Check:
1. Does the README accurately describe what the code actually does?
2. Are the claimed features visible in the code?
3. Do the dependencies make sense for the project?
4. Are there any signs of copy-paste inconsistency (e.g., README describes features not in the code)?

Return JSON:
{
  "readmeMatchesCode": boolean,
  "unusedDependencies": ["dep1"],
  "missingDependencies": ["dep1"],
  "overallConsistency": "consistent" | "minor_issues" | "suspicious",
  "findings": ["finding1", "finding2"]
}`;

export class EffortVerificationCheck extends BaseCheck {
  id = "effort_verification";
  name = "Effort Verification";
  description = "Cross-references multiple signals to verify genuine development effort.";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const allBlobs = context.tree
      .filter((e) => e.type === "blob")
      .filter((e) => !SKIP_DIRS.some((dir) => e.path.includes(dir)));

    if (allBlobs.length === 0) {
      return this.skip("No files to analyze", config);
    }

    const evidence: string[] = [];

    // ── Phase 1: Collect code metrics ──────────────────────

    const sourceFiles = allBlobs
      .filter((e) => SOURCE_EXTENSIONS.some((ext) => e.path.toLowerCase().endsWith(ext)))
      .filter((e) => !isGenerated(e.path));

    const meaningfulSourceFiles = sourceFiles.filter(
      (e) => !isConfigFile(e.path) && !isTestFile(e.path),
    );

    const metrics: CodeMetrics = {
      totalSourceFiles: sourceFiles.length,
      meaningfulSourceFiles: meaningfulSourceFiles.length,
      totalLinesOfCode: 0,
      blankLines: 0,
      commentLines: 0,
      netCodeLines: 0,
      uniqueImports: new Set<string>(),
      languageBreakdown: new Map<string, number>(),
      hasTests: false,
      testFileCount: 0,
      hasCustomCss: false,
      hasDbSchemas: false,
      hasMigrations: false,
      hasEnvUsage: false,
      routeCount: countRoutes(context.tree),
      componentCount: countComponents(context.tree),
    };

    // Count test files
    const testFiles = sourceFiles.filter((e) => isTestFile(e.path));
    metrics.hasTests = testFiles.length > 0;
    metrics.testFileCount = testFiles.length;

    // Detect DB schemas and migrations from file tree
    for (const e of allBlobs) {
      const lower = e.path.toLowerCase();
      if (/schema\.(prisma|graphql|sql)$/.test(lower) || /models\.(py|ts|js)$/.test(lower)) {
        metrics.hasDbSchemas = true;
      }
      if (/migrations?\//i.test(lower) || /migrate/i.test(lower)) {
        metrics.hasMigrations = true;
      }
      if (/\.env\.example$|\.env\.local$|\.env\.sample$/i.test(lower)) {
        metrics.hasEnvUsage = true;
      }
    }

    // Read source files and collect metrics (sample up to 15 files)
    const filesToAnalyze = meaningfulSourceFiles
      .filter((e) => e.size != null)
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 15);

    const readFiles: Array<{ path: string; content: string }> = [];
    const allImports: string[] = [];

    for (const entry of filesToAnalyze) {
      try {
        const content = await context.getFile(entry.path);
        if (!content) continue;

        const lineMetrics = countCodeLines(content);
        metrics.totalLinesOfCode += lineMetrics.total;
        metrics.blankLines += lineMetrics.blank;
        metrics.commentLines += lineMetrics.comment;
        metrics.netCodeLines += lineMetrics.net;

        const lang = getLanguage(entry.path);
        if (lang) {
          metrics.languageBreakdown.set(lang, (metrics.languageBreakdown.get(lang) || 0) + lineMetrics.net);
        }

        const imports = extractImports(content, entry.path);
        for (const imp of imports) {
          metrics.uniqueImports.add(imp);
          allImports.push(imp);
        }

        // Check for custom CSS
        if (/\.(css|scss|sass|less)$/.test(entry.path.toLowerCase())) {
          if (lineMetrics.net > 20) metrics.hasCustomCss = true;
        }

        // Check for env usage
        if (content.includes("process.env.") || content.includes("os.environ") || content.includes("os.getenv")) {
          metrics.hasEnvUsage = true;
        }

        const truncated = content.length > 4000 ? content.slice(0, 4000) : content;
        readFiles.push({ path: entry.path, content: truncated });
      } catch {
        // Skip unreadable files
      }
    }

    // If we only sampled a subset, extrapolate
    if (filesToAnalyze.length < meaningfulSourceFiles.length) {
      const ratio = meaningfulSourceFiles.length / filesToAnalyze.length;
      metrics.netCodeLines = Math.round(metrics.netCodeLines * ratio);
      metrics.totalLinesOfCode = Math.round(metrics.totalLinesOfCode * ratio);
      evidence.push(`(Metrics extrapolated from ${filesToAnalyze.length}/${meaningfulSourceFiles.length} files)`);
    }

    // ── Phase 2: Dependency consistency ────────────────────

    let declaredDeps: DependencyInfo = { declared: [], devDeclared: [] };
    let depSource = "";

    const pkgJson = allBlobs.find((e) => e.path === "package.json" || e.path.endsWith("/package.json"));
    if (pkgJson) {
      const content = await context.getFile(pkgJson.path);
      if (content) {
        declaredDeps = parsePackageJsonDeps(content);
        depSource = "package.json";
      }
    }

    if (declaredDeps.declared.length === 0) {
      const reqTxt = allBlobs.find((e) =>
        e.path.toLowerCase() === "requirements.txt" ||
        e.path.toLowerCase().endsWith("/requirements.txt"),
      );
      if (reqTxt) {
        const content = await context.getFile(reqTxt.path);
        if (content) {
          declaredDeps = parseRequirementsTxt(content);
          depSource = "requirements.txt";
        }
      }
    }

    let unusedDeps: string[] = [];
    let usedImports = metrics.uniqueImports;

    if (declaredDeps.declared.length > 0) {
      // Find declared deps not used in any import
      unusedDeps = declaredDeps.declared.filter((dep) => {
        const depLower = dep.toLowerCase();
        // Check if any import starts with or matches the dep name
        return ![...usedImports].some((imp) => {
          const impLower = imp.toLowerCase();
          return impLower === depLower || impLower.startsWith(depLower + "/");
        });
      });

      // Filter out common deps that are used implicitly (frameworks, build tools)
      const implicitDeps = new Set([
        "react", "react-dom", "next", "nuxt", "vue", "svelte", "@sveltejs/kit",
        "typescript", "vite", "@vitejs/plugin-react", "tailwindcss", "postcss",
        "autoprefixer", "eslint", "prettier", "jest", "vitest", "webpack",
        "babel", "@types/node", "@types/react", "nodemon", "ts-node", "tsx",
        "express", "dotenv", "prisma", "@prisma/client",
      ]);

      unusedDeps = unusedDeps.filter((d) => !implicitDeps.has(d.toLowerCase()));

      evidence.push(`Dependencies (${depSource}): ${declaredDeps.declared.length} declared, ${usedImports.size} unique imports found in code`);
      if (unusedDeps.length > 0) {
        evidence.push(`Potentially unused dependencies: ${unusedDeps.slice(0, 10).join(", ")}${unusedDeps.length > 10 ? ` (+${unusedDeps.length - 10} more)` : ""}`);
      }
    }

    // ── Phase 3: Build evidence summary ────────────────────

    evidence.push(`Source files: ${metrics.totalSourceFiles} total, ${metrics.meaningfulSourceFiles} meaningful`);
    evidence.push(`Code: ${metrics.netCodeLines} net lines (${metrics.commentLines} comment, ${metrics.blankLines} blank)`);

    const langEntries = [...metrics.languageBreakdown.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lang, lines]) => `${lang}: ${lines}`)
      .join(", ");
    if (langEntries) {
      evidence.push(`Languages: ${langEntries}`);
    }

    evidence.push(`Unique imports: ${metrics.uniqueImports.size}`);
    if (metrics.routeCount > 0) evidence.push(`Routes/pages detected: ${metrics.routeCount}`);
    if (metrics.componentCount > 0) evidence.push(`Components detected: ${metrics.componentCount}`);
    if (metrics.hasTests) evidence.push(`Test files: ${metrics.testFileCount}`);
    if (metrics.hasDbSchemas) evidence.push("Database schemas detected");
    if (metrics.hasMigrations) evidence.push("Database migrations detected");
    if (metrics.hasCustomCss) evidence.push("Custom CSS/styling detected");
    if (metrics.hasEnvUsage) evidence.push("Environment variable usage detected");

    // ── Phase 4: Hour estimate and cross-reference ─────────

    const hourEstimate = estimateHours(metrics);
    evidence.push(`Estimated effort: ${hourEstimate.justification}`);

    const hoursReported = config.hoursReported as number | undefined;
    let hourMismatch = false;

    if (hoursReported != null && hoursReported > 0) {
      evidence.push(`Reported hours: ${hoursReported}`);

      if (hoursReported > hourEstimate.maxHours * 3) {
        evidence.push(`WARNING: Reported ${hoursReported}h is significantly more than estimated max ${hourEstimate.maxHours}h - possible over-reporting`);
        hourMismatch = true;
      } else if (hoursReported < hourEstimate.minHours * 0.3 && hourEstimate.minHours > 5) {
        evidence.push(`WARNING: Reported ${hoursReported}h seems low for estimated min ${hourEstimate.minHours}h - possible under-reporting or AI assistance`);
        hourMismatch = true;
      }
    }

    // ── Phase 5: AI-powered consistency check (optional) ───

    let aiConsistency: ConsistencyAnalysis | null = null;

    if (this.claude && context.readme && readFiles.length > 0) {
      try {
        const contextData = [
          `=== README ===\n${context.readme.slice(0, 2000)}`,
          "",
          declaredDeps.declared.length > 0
            ? `=== DECLARED DEPENDENCIES ===\n${declaredDeps.declared.join(", ")}`
            : "",
          "",
          `=== CODE SAMPLES (${readFiles.length} files) ===`,
          ...readFiles.slice(0, 4).map(({ path, content }) =>
            `--- ${path} ---\n${content.slice(0, 2000)}`,
          ),
        ].join("\n");

        const prompt = (config.prompt as string) || CONSISTENCY_PROMPT;
        aiConsistency = await this.claude.askStructured<ConsistencyAnalysis>(
          prompt,
          contextData,
          1024,
        );

        evidence.push(`[AI Consistency] ${aiConsistency.overallConsistency}`);
        for (const finding of aiConsistency.findings) {
          evidence.push(`[AI Finding] ${finding}`);
        }

        if (!aiConsistency.readmeMatchesCode) {
          evidence.push("[AI Warning] README does not accurately match the actual codebase");
        }
      } catch {
        evidence.push("[AI Consistency] Analysis failed - using heuristics only");
      }
    }

    // ── Phase 6: Final scoring ─────────────────────────────

    let effortScore = 0;
    const maxScore = 100;

    // Code volume (0-25 points)
    if (metrics.netCodeLines >= 500) effortScore += 25;
    else if (metrics.netCodeLines >= 200) effortScore += 20;
    else if (metrics.netCodeLines >= 100) effortScore += 15;
    else if (metrics.netCodeLines >= 50) effortScore += 10;
    else effortScore += 5;

    // File diversity (0-15 points)
    if (metrics.meaningfulSourceFiles >= 10) effortScore += 15;
    else if (metrics.meaningfulSourceFiles >= 5) effortScore += 10;
    else if (metrics.meaningfulSourceFiles >= 3) effortScore += 7;
    else effortScore += 3;

    // Language diversity (0-10 points)
    if (metrics.languageBreakdown.size >= 3) effortScore += 10;
    else if (metrics.languageBreakdown.size >= 2) effortScore += 7;
    else effortScore += 3;

    // Feature indicators (0-20 points)
    if (metrics.routeCount >= 3) effortScore += 5;
    else if (metrics.routeCount >= 1) effortScore += 3;

    if (metrics.componentCount >= 5) effortScore += 5;
    else if (metrics.componentCount >= 2) effortScore += 3;

    if (metrics.hasDbSchemas) effortScore += 5;
    if (metrics.hasEnvUsage) effortScore += 3;
    if (metrics.hasCustomCss) effortScore += 2;

    // Development practices (0-10 points)
    if (metrics.hasTests) effortScore += 5;
    if (metrics.hasMigrations) effortScore += 5;

    // Dependency usage (0-10 points)
    if (metrics.uniqueImports.size >= 5) effortScore += 10;
    else if (metrics.uniqueImports.size >= 3) effortScore += 7;
    else if (metrics.uniqueImports.size >= 1) effortScore += 3;

    // Penalties
    if (unusedDeps.length > declaredDeps.declared.length * 0.5 && declaredDeps.declared.length >= 5) {
      effortScore -= 10;
      evidence.push("Penalty: >50% of declared dependencies appear unused (copy-paste indicator)");
    }

    if (hourMismatch) {
      effortScore -= 10;
    }

    if (aiConsistency?.overallConsistency === "suspicious") {
      effortScore -= 15;
    } else if (aiConsistency?.overallConsistency === "minor_issues") {
      effortScore -= 5;
    }

    effortScore = Math.max(0, Math.min(maxScore, effortScore));
    evidence.push(`Effort score: ${effortScore}/${maxScore}`);

    // ── Decision ───────────────────────────────────────────

    const usedAi = aiConsistency !== null;

    if (effortScore <= 20) {
      return {
        checkName: this.id,
        required: config.required,
        status: config.severity === "warning" ? "warning" : "fail",
        confidence: usedAi ? 0.8 : 0.6,
        evidence,
        reason: `Project shows minimal genuine effort (score: ${effortScore}/100). ${metrics.netCodeLines} net lines of code across ${metrics.meaningfulSourceFiles} files.`,
        aiUsed: usedAi,
      };
    }

    if (effortScore <= 40) {
      return {
        checkName: this.id,
        required: config.required ?? false,
        status: "warning",
        confidence: usedAi ? 0.75 : 0.55,
        evidence,
        reason: `Project shows limited effort (score: ${effortScore}/100). May need more development to be considered a complete submission.`,
        aiUsed: usedAi,
      };
    }

    return {
      checkName: this.id,
      required: config.required,
      status: "pass",
      confidence: usedAi ? 0.85 : 0.65,
      evidence,
      reason: `Project demonstrates genuine development effort (score: ${effortScore}/100). ${hourEstimate.justification}`,
      aiUsed: usedAi,
    };
  }
}
