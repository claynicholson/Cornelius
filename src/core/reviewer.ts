import type { RepoContext, ReviewResult, CheckResult, PresetConfig, CommitDetail, GitForensicsData } from "./types.js";
import { GitHubClient } from "../github/client.js";
import { ClaudeClient } from "../ai/claude.js";
import { parseGitHubUrl } from "../github/parser.js";
import { createChecks } from "../checks/index.js";
import { getCheckConfig, loadPreset } from "./preset.js";
import { loadInstructions } from "./instructions.js";
import { computeTrustScore, type TrustScore } from "./trustScore.js";

export interface HourContext {
  hoursReported?: number;
  journalCount?: number;
  journal?: string;
}

export interface ReviewOptions {
  ghProxyApiKey?: string;
  anthropicApiKey?: string;
  preset?: string;
  presetConfig?: PresetConfig;
  hourContext?: HourContext;
  playableUrl?: string;
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

  // Load instruction file if preset references one
  const instructions = preset.instructions
    ? loadInstructions(preset.instructions)
    : {};

  const github = new GitHubClient(options.ghProxyApiKey);
  const claude = options.anthropicApiKey
    ? new ClaudeClient(options.anthropicApiKey, undefined, preset.maxBudget)
    : undefined;

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

  // Fetch git forensics data (non-blocking - failures are tolerated)
  try {
    const [commits, contributors, metadata, weeklyActivity] = await Promise.all([
      github.getCommits(parsed.owner, parsed.repo, 100),
      github.getContributors(parsed.owner, parsed.repo),
      github.getRepoMetadata(parsed.owner, parsed.repo),
      github.getCommitActivity(parsed.owner, parsed.repo),
    ]);

    // Fetch details for a sample of commits (first, last, and up to 8 evenly spaced)
    const commitDetails: CommitDetail[] = [];
    if (commits.length > 0) {
      const sampleIndices = new Set<number>();
      sampleIndices.add(0); // most recent
      sampleIndices.add(commits.length - 1); // oldest
      // Evenly spaced samples in between
      const step = Math.max(1, Math.floor(commits.length / 8));
      for (let i = 0; i < commits.length && sampleIndices.size < 10; i += step) {
        sampleIndices.add(i);
      }

      const detailPromises = [...sampleIndices].map((idx) =>
        github.getCommitDetail(parsed.owner, parsed.repo, commits[idx].sha)
      );
      const detailResults = await Promise.all(detailPromises);
      for (const detail of detailResults) {
        if (detail) commitDetails.push(detail);
      }
    }

    const forensicsData: GitForensicsData = {
      commits,
      commitDetails,
      contributors,
      metadata,
      weeklyActivity,
    };

    context.forensics = forensicsData;
  } catch {
    // Forensics data is optional - checks will skip if not available
  }

  // Run checks
  const checks = createChecks(claude);
  const results: CheckResult[] = [];

  for (const check of checks) {
    const config = getCheckConfig(preset, check.id);
    // Inject project type so AI checks can adapt their prompts
    config.projectType = preset.projectType || "hardware";

    // Inject prompt from instruction file if available
    if (instructions[check.id]) {
      config.prompt = instructions[check.id];
    }

    // Inject playable URL for url_alive check
    if (check.id === "url_alive" && options.playableUrl) {
      config.url = options.playableUrl;
    }

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

  // Compute trust score before AI summary so it can be referenced
  const trustScore = computeTrustScore({
    checkResults: results,
    projectType: preset.projectType || "hardware",
    forensics: context.forensics,
    hourContext: options.hourContext
      ? {
          hoursReported: options.hourContext.hoursReported,
          journalCount: options.hourContext.journalCount,
        }
      : undefined,
  });

  // Generate AI summary if available
  let aiSummary: string | undefined;
  let suggestedFixes: string[] | undefined;

  if (claude) {
    try {
      const trustContext = `
Trust Score: ${trustScore.overall}/100 (${trustScore.category})
Breakdown:
- Code Authenticity: ${trustScore.breakdown.codeAuthenticity}/100
- Effort Verification: ${trustScore.breakdown.effortVerification}/100
- Project Completeness: ${trustScore.breakdown.projectCompleteness}/100
- Deployment Status: ${trustScore.breakdown.deploymentStatus}/100
- Development Process: ${trustScore.breakdown.developmentProcess}/100
${trustScore.flags.length > 0 ? `\nFlags:\n${trustScore.flags.map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`).join("\n")}` : ""}
Recommendation: ${trustScore.recommendation}`;

      const defaultSummaryPrompt = `Based on these review results for a ${preset.projectType || "hardware"} project repository, provide a brief summary and any suggested fixes. This is a ${preset.projectType || "hardware"} project — frame your feedback accordingly.

The trust score system has analyzed this project across multiple dimensions. Incorporate the trust score findings into your summary. If there are critical or warning flags, mention the specific concerns. If the trust score is low, explain what is driving it down.

${trustContext}

Return JSON: {"summary": "brief summary", "fixes": ["fix1", "fix2"]}`;

      const summaryPrompt = instructions.summary
        ? `${instructions.summary}\n\n${trustContext}`
        : defaultSummaryPrompt;

      const summaryData = await claude.askStructured<{
        summary: string;
        fixes: string[];
      }>(summaryPrompt, JSON.stringify(results, null, 2));
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

  // Generate hour estimate and justification
  let hourEstimate: number | undefined;
  let hourJustification: string | undefined;

  if (claude) {
    try {
      const hourCtx = options.hourContext || {};
      const hasHourData = hourCtx.hoursReported != null || hourCtx.journal;

      const projectType = preset.projectType || "hardware";
      const isSoftware = projectType === "software";

      const deepReviewResult = results.find((r) => r.checkName === "deep_code_review");

      const projectInfo = {
        repoUrl: url,
        fileCount: context.tree.length,
        has3dFiles: results.find((r) => r.checkName === "three_d_files_present")?.status === "pass",
        hasPcbFiles: results.find((r) => r.checkName === "pcb_files_present")?.status === "pass",
        hasBom: results.find((r) => r.checkName === "bom_present_if_required")?.status === "pass",
        hasSourceCode: results.find((r) => r.checkName === "source_code_present")?.status === "pass",
        codeQuality: results.find((r) => r.checkName === "code_quality_overview")?.status,
        deepReview: deepReviewResult?.status,
        deepReviewReason: deepReviewResult?.reason,
        readmeQuality: results.find((r) => r.checkName === "readme_quality")?.status,
        urlAlive: results.find((r) => r.checkName === "url_alive")?.status,
        overallPass,
        hoursReported: hourCtx.hoursReported,
        journalCount: hourCtx.journalCount,
        journal: hourCtx.journal,
      };

      const hardwareGuidelines = `Guidelines for hour estimation (hardware projects):
- A basic keyboard PCB project typically takes 15-20 hours
- A simple case-only or single-component project is 5-8 hours
- Complex custom projects (phones, robots, custom gear systems) can be 30-80 hours
- Setting up a git repo should be 0.5 hours max
- "Thinking about an idea" is not verifiable work
- Spray painting / simple finishing tasks are 0.5-1 hour`;

      const softwareGuidelines = `Guidelines for hour estimation (software projects):
- A simple static website or single-page app is 5-10 hours
- A basic CRUD app or bot with a few features is 10-20 hours
- A full-stack app with auth, database, and multiple features is 20-50 hours
- Complex projects (real-time apps, game engines, compilers) can be 40-100 hours
- Using a framework scaffold or starter template counts for very little (0.5-1 hour)
- Copy-pasting tutorial code is not verifiable work
- Setting up a git repo should be 0.5 hours max`;

      const trustScoreContext = `
Trust Score: ${trustScore.overall}/100 (${trustScore.category})
- Code Authenticity: ${trustScore.breakdown.codeAuthenticity}/100
- Effort Verification: ${trustScore.breakdown.effortVerification}/100
${trustScore.flags.filter((f) => f.severity === "critical" || f.severity === "warning").map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`).join("\n")}`;

      const defaultHourPrompt = `You are a reviewer for Hack Club's YSWS program. You need to estimate how many hours this ${projectType} project actually took and write a human-sounding justification.

${hasHourData ? `The user self-reported ${hourCtx.hoursReported ?? "unknown"} hours across ${hourCtx.journalCount ?? "unknown"} journal entries.` : "No self-reported hours or journal were provided."}

${hourCtx.journal ? `Their journal content:\n${hourCtx.journal}` : ""}

Context about the project repository:
- Project type: ${projectType}
- Total files: ${projectInfo.fileCount}
${isSoftware ? `- Has source code: ${projectInfo.hasSourceCode}
- Code quality: ${projectInfo.codeQuality || projectInfo.deepReview}${projectInfo.deepReviewReason ? `\n- Deep review: ${projectInfo.deepReviewReason}` : ""}${projectInfo.urlAlive ? `\n- Deployed URL: ${projectInfo.urlAlive}` : ""}` : `- Has 3D/CAD files: ${projectInfo.has3dFiles}
- Has PCB design files: ${projectInfo.hasPcbFiles}
- Has BOM: ${projectInfo.hasBom}`}
- README quality: ${projectInfo.readmeQuality}
- Overall review: ${overallPass ? "passed" : "failed"}

${trustScoreContext}

${isSoftware ? softwareGuidelines : hardwareGuidelines}

General rules:
- If journal entries are sparse or vague, deflate more aggressively
- If journal entries are detailed and show real iteration, deflate less
- Programming hours without detail should be deflated
- Look for signs of inflation: large hour counts with little detail, simple tasks reported as many hours
- IMPORTANT: If the trust score is "suspicious" or "rejected" (below 40), be much more skeptical of reported hours and deflate aggressively
- If the trust score flags indicate single-commit project or AI-generated code, cap your estimate at the minimum for this project type

Write a natural, human-sounding justification (2-4 sentences) like a real reviewer would. Be direct and specific about why you're giving those hours. Reference specific journal entries or project aspects if available. Match the tone of these example justifications - casual, honest, sometimes blunt.

Return JSON: {"hourEstimate": <number>, "justification": "<string>"}`;

      const hourPrompt = instructions.hour_estimation || defaultHourPrompt;

      // If using instruction file prompt, append the dynamic context
      const hourContent = instructions.hour_estimation
        ? `${hasHourData ? `The user self-reported ${hourCtx.hoursReported ?? "unknown"} hours across ${hourCtx.journalCount ?? "unknown"} journal entries.` : "No self-reported hours or journal were provided."}

${hourCtx.journal ? `Their journal content:\n${hourCtx.journal}` : ""}

Context about the project repository:
${JSON.stringify(projectInfo, null, 2)}

Check results:
${JSON.stringify(results, null, 2)}`
        : JSON.stringify(results, null, 2);

      const hourData = await claude.askStructured<{
        hourEstimate: number;
        justification: string;
      }>(hourPrompt, hourContent);

      hourEstimate = hourData.hourEstimate;
      hourJustification = hourData.justification;
    } catch {
      // Hour estimation is optional
    }
  }

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
    trustScore,
    hourEstimate,
    hourJustification,
    apiCost: claude
      ? {
          inputTokens: claude.totalUsage.inputTokens,
          outputTokens: claude.totalUsage.outputTokens,
          totalCost: Math.round(claude.totalUsage.cost * 1_000_000) / 1_000_000,
          callCount: claude.callCount,
        }
      : undefined,
  };
}
