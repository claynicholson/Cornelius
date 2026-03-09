import type { RepoContext, ReviewResult, CheckResult, PresetConfig } from "./types.js";
import { GitHubClient } from "../github/client.js";
import { ClaudeClient } from "../ai/claude.js";
import { parseGitHubUrl } from "../github/parser.js";
import { createChecks } from "../checks/index.js";
import { getCheckConfig, loadPreset } from "./preset.js";

export interface ReviewOptions {
  ghProxyApiKey?: string;
  anthropicApiKey?: string;
  preset?: string;
  presetConfig?: PresetConfig;
}

export async function reviewRepository(
  url: string,
  options: ReviewOptions = {}
): Promise<ReviewResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return {
      githubUrl: url,
      status: "error",
      overallPass: false,
      checkResults: [],
      warnings: [],
      errors: ["Invalid GitHub URL"],
      confidenceScore: 0,
    };
  }

  const github = new GitHubClient(options.ghProxyApiKey);
  const claude = options.anthropicApiKey
    ? new ClaudeClient(options.anthropicApiKey)
    : undefined;

  // Load preset
  let preset: PresetConfig;
  if (options.presetConfig) {
    preset = options.presetConfig;
  } else {
    try {
      preset = loadPreset(options.preset || "default");
    } catch {
      preset = {
        name: "default",
        projectType: "hardware",
        checks: {},
      };
    }
  }

  // Build repo context
  let context: RepoContext;
  try {
    const exists = await github.repoExists(parsed.owner, parsed.repo);
    if (!exists) {
      return {
        githubUrl: url,
        status: "fail",
        overallPass: false,
        checkResults: [
          {
            checkName: "github_link_works",
            required: true,
            status: "fail",
            confidence: 1,
            evidence: [url],
            reason: "Repository does not exist or is not accessible",
            aiUsed: false,
          },
        ],
        warnings: [],
        errors: [],
        confidenceScore: 1,
      };
    }

    const [tree, readme, defaultBranch] = await Promise.all([
      github.getRepoTree(parsed.owner, parsed.repo),
      github.getReadme(parsed.owner, parsed.repo),
      github.getDefaultBranch(parsed.owner, parsed.repo),
    ]);

    context = {
      owner: parsed.owner,
      repo: parsed.repo,
      url: parsed.url,
      tree,
      readme,
      defaultBranch,
      getFile: (path: string) =>
        github.getFileContent(parsed.owner, parsed.repo, path),
    };
  } catch (err) {
    return {
      githubUrl: url,
      status: "error",
      overallPass: false,
      checkResults: [],
      warnings: [],
      errors: [
        `Failed to fetch repository: ${err instanceof Error ? err.message : String(err)}`,
      ],
      confidenceScore: 0,
    };
  }

  // Run checks
  const checks = createChecks(claude);
  const results: CheckResult[] = [];

  for (const check of checks) {
    const config = getCheckConfig(preset, check.id);

    if (!config.enabled) {
      results.push({
        checkName: check.id,
        required: config.required,
        status: "skipped",
        confidence: 1,
        evidence: [],
        reason: "Check disabled in preset",
        aiUsed: false,
      });
      continue;
    }

    try {
      const result = await check.run(context, config);
      results.push(result);
    } catch (err) {
      results.push({
        checkName: check.id,
        required: config.required,
        status: "error",
        confidence: 0,
        evidence: [],
        reason: `Check threw error: ${err instanceof Error ? err.message : String(err)}`,
        aiUsed: false,
      });
    }
  }

  // Compute overall status
  const requiredFails = results.filter(
    (r) => r.required && (r.status === "fail" || r.status === "error")
  );
  const warnings = results.filter((r) => r.status === "warning");
  const overallPass = requiredFails.length === 0;

  const overallStatus = requiredFails.length > 0
    ? "fail"
    : warnings.length > 0
      ? "warning"
      : "pass";

  // Generate AI summary if available
  let aiSummary: string | undefined;
  let suggestedFixes: string[] | undefined;

  if (claude) {
    try {
      const summaryData = await claude.askStructured<{
        summary: string;
        fixes: string[];
      }>(
        `Based on these review results for a hardware project repository, provide a brief summary and any suggested fixes.

Return JSON: {"summary": "brief summary", "fixes": ["fix1", "fix2"]}`,
        JSON.stringify(results, null, 2)
      );
      aiSummary = summaryData.summary;
      suggestedFixes = summaryData.fixes;
    } catch {
      // AI summary is optional
    }
  }

  const confidenceScores = results
    .filter((r) => r.status !== "skipped")
    .map((r) => r.confidence);
  const avgConfidence =
    confidenceScores.length > 0
      ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
      : 0;

  return {
    githubUrl: url,
    status: overallStatus,
    overallPass,
    checkResults: results,
    warnings: warnings.map((w) => `${w.checkName}: ${w.reason}`),
    errors: requiredFails.map((f) => `${f.checkName}: ${f.reason}`),
    aiSummary,
    suggestedFixes,
    confidenceScore: Math.round(avgConfidence * 100) / 100,
  };
}
