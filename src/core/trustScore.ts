import type { CheckResult, GitForensicsData } from "./types.js";

// ── Trust Score Types ─────────────────────────────────────

export interface TrustScore {
  overall: number; // 0-100
  category:
    | "trusted"
    | "likely_genuine"
    | "needs_review"
    | "suspicious"
    | "rejected";
  breakdown: {
    codeAuthenticity: number; // 0-100 - Is the code original?
    effortVerification: number; // 0-100 - Does effort match claims?
    projectCompleteness: number; // 0-100 - Is this a real, complete project?
    deploymentStatus: number; // 0-100 - Is it actually deployed/functional?
    developmentProcess: number; // 0-100 - Does git history show real dev?
  };
  flags: TrustFlag[];
  recommendation: string; // Human-readable recommendation for reviewer
}

export interface TrustFlag {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
}

// ── Weight profiles by project type ───────────────────────

interface WeightProfile {
  codeAuthenticity: number;
  effortVerification: number;
  projectCompleteness: number;
  deploymentStatus: number;
  developmentProcess: number;
}

const SOFTWARE_WEIGHTS: WeightProfile = {
  codeAuthenticity: 0.3,
  effortVerification: 0.25,
  projectCompleteness: 0.2,
  deploymentStatus: 0.15,
  developmentProcess: 0.1,
};

const HARDWARE_WEIGHTS: WeightProfile = {
  codeAuthenticity: 0.2,
  effortVerification: 0.25,
  projectCompleteness: 0.35,
  deploymentStatus: 0.05,
  developmentProcess: 0.15,
};

// ── Category thresholds ───────────────────────────────────

function categorize(
  score: number
): TrustScore["category"] {
  if (score >= 80) return "trusted";
  if (score >= 60) return "likely_genuine";
  if (score >= 40) return "needs_review";
  if (score >= 20) return "suspicious";
  return "rejected";
}

// ── Helper: get check by name ─────────────────────────────

function findCheck(
  results: CheckResult[],
  name: string
): CheckResult | undefined {
  return results.find((r) => r.checkName === name);
}

function checkPassed(results: CheckResult[], name: string): boolean {
  const check = findCheck(results, name);
  return check?.status === "pass";
}

function checkFailed(results: CheckResult[], name: string): boolean {
  const check = findCheck(results, name);
  return check?.status === "fail" || check?.status === "error";
}

function checkEnabled(results: CheckResult[], name: string): boolean {
  const check = findCheck(results, name);
  return check != null && check.status !== "skipped";
}

// ── Scoring functions for each category ───────────────────

function scoreCodeAuthenticity(
  results: CheckResult[],
  projectType: string,
  forensics?: GitForensicsData
): { score: number; flags: TrustFlag[] } {
  const flags: TrustFlag[] = [];
  let score = 50; // baseline

  // Deep code review results (AI-based originality)
  const deepReview = findCheck(results, "deep_code_review");
  if (deepReview) {
    if (deepReview.status === "pass") {
      score += 30;
    } else if (deepReview.status === "warning") {
      score += 10;
    } else if (deepReview.status === "fail") {
      score -= 30;
      // Check evidence for AI-generated code signals
      const aiGenEvidence = deepReview.evidence.some(
        (e) =>
          e.toLowerCase().includes("ai generated") ||
          e.toLowerCase().includes("ai-generated") ||
          e.toLowerCase().includes("template") ||
          e.toLowerCase().includes("boilerplate")
      );
      if (aiGenEvidence) {
        flags.push({
          severity: "critical",
          category: "codeAuthenticity",
          message:
            "Code appears to be AI-generated or directly from a template with no meaningful changes",
        });
      }
    }
  }

  // Code quality check
  const codeQuality = findCheck(results, "code_quality_overview");
  if (codeQuality) {
    if (codeQuality.status === "pass") {
      score += 15;
    } else if (codeQuality.status === "warning") {
      score += 5;
    } else if (codeQuality.status === "fail") {
      score -= 15;
    }
  }

  // Source code presence
  if (projectType === "software") {
    if (checkPassed(results, "source_code_present")) {
      score += 5;
    } else if (checkFailed(results, "source_code_present")) {
      score -= 20;
      flags.push({
        severity: "critical",
        category: "codeAuthenticity",
        message: "No meaningful source code found in repository",
      });
    }
  }

  // Git forensics: check contributor diversity
  if (forensics) {
    if (forensics.contributors.length === 1) {
      // Single contributor is normal for student projects, slight neutral
      score += 0;
    }

    // Check for suspicious commit patterns
    const totalCommits = forensics.commits.length;
    if (totalCommits <= 1) {
      flags.push({
        severity: "critical",
        category: "codeAuthenticity",
        message:
          "Single-commit project — entire codebase was uploaded at once, which is a strong indicator of copy-paste or AI generation",
      });
      score -= 25;
    } else if (totalCommits <= 3) {
      flags.push({
        severity: "warning",
        category: "codeAuthenticity",
        message:
          "Very few commits — project may have been bulk-uploaded rather than developed iteratively",
      });
      score -= 10;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), flags };
}

function scoreEffortVerification(
  results: CheckResult[],
  projectType: string,
  forensics?: GitForensicsData,
  hourContext?: { hoursReported?: number; journalCount?: number }
): { score: number; flags: TrustFlag[] } {
  const flags: TrustFlag[] = [];
  let score = 50;

  // README quality as effort signal
  const readmeQuality = findCheck(results, "readme_quality");
  if (readmeQuality) {
    if (readmeQuality.status === "pass") {
      score += 15;
    } else if (readmeQuality.status === "fail") {
      score -= 10;
    }
  }

  // Deep code review complexity signal
  const deepReview = findCheck(results, "deep_code_review");
  if (deepReview && deepReview.status === "pass") {
    // Check evidence for complexity indicators
    const complexityEvidence = deepReview.evidence.some(
      (e) =>
        e.toLowerCase().includes("complex") ||
        e.toLowerCase().includes("multiple features") ||
        e.toLowerCase().includes("full-stack")
    );
    if (complexityEvidence) {
      score += 15;
    } else {
      score += 5;
    }
  }

  // Forensics-based effort signals
  if (forensics) {
    // Weekly activity spread
    const activeWeeks = forensics.weeklyActivity.filter(
      (w) => w.commits > 0
    ).length;
    if (activeWeeks >= 4) {
      score += 15;
    } else if (activeWeeks >= 2) {
      score += 8;
    } else if (activeWeeks <= 1) {
      flags.push({
        severity: "warning",
        category: "effortVerification",
        message:
          "All development activity concentrated in a single week or less",
      });
      score -= 5;
    }

    // Total code volume from commit details
    const totalAdditions = forensics.commitDetails.reduce(
      (sum, c) => sum + c.stats.additions,
      0
    );
    if (totalAdditions > 2000) {
      score += 10;
    } else if (totalAdditions > 500) {
      score += 5;
    } else if (totalAdditions < 100) {
      flags.push({
        severity: "warning",
        category: "effortVerification",
        message: `Very low code volume (${totalAdditions} lines added) — may indicate minimal effort`,
      });
      score -= 10;
    }
  }

  // Hour reporting cross-reference
  if (hourContext?.hoursReported != null) {
    if (hourContext.hoursReported > 100) {
      flags.push({
        severity: "warning",
        category: "effortVerification",
        message: `Self-reported ${hourContext.hoursReported} hours — unusually high, verify against code volume`,
      });
      score -= 5;
    }
    if (
      hourContext.journalCount != null &&
      hourContext.hoursReported > 20 &&
      hourContext.journalCount < 3
    ) {
      flags.push({
        severity: "warning",
        category: "effortVerification",
        message: `Reported ${hourContext.hoursReported} hours but only ${hourContext.journalCount} journal entries — insufficient documentation of effort`,
      });
      score -= 10;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), flags };
}

function scoreProjectCompleteness(
  results: CheckResult[],
  projectType: string
): { score: number; flags: TrustFlag[] } {
  const flags: TrustFlag[] = [];
  let score = 50;

  // README presence and quality
  if (checkPassed(results, "readme_present")) {
    score += 10;
  } else if (checkFailed(results, "readme_present")) {
    score -= 20;
  }

  if (checkPassed(results, "readme_quality")) {
    score += 10;
  }

  // Project images
  if (checkPassed(results, "readme_has_project_image")) {
    score += 10;
  } else if (checkFailed(results, "readme_has_project_image")) {
    flags.push({
      severity: "info",
      category: "projectCompleteness",
      message: "No project images in README",
    });
    score -= 5;
  }

  if (projectType === "software") {
    // Software completeness signals
    if (checkPassed(results, "source_code_present")) {
      score += 10;
    }
    if (checkPassed(results, "package_manager_present")) {
      score += 5;
    }
    if (checkPassed(results, "deep_code_review")) {
      score += 10;
    } else if (checkFailed(results, "deep_code_review")) {
      score -= 15;
    }
  } else {
    // Hardware completeness signals
    if (checkPassed(results, "three_d_files_present")) {
      score += 15;
    } else if (checkFailed(results, "three_d_files_present")) {
      score -= 15;
    }
    if (checkPassed(results, "pcb_files_present")) {
      score += 10;
    } else if (checkFailed(results, "pcb_files_present")) {
      score -= 10;
    }
    if (checkPassed(results, "bom_present_if_required")) {
      score += 5;
    }
  }

  // Gitignore and license as completeness signals
  if (checkPassed(results, "gitignore_present")) {
    score += 3;
  } else if (
    checkEnabled(results, "gitignore_present") &&
    !checkPassed(results, "gitignore_present")
  ) {
    flags.push({
      severity: "info",
      category: "projectCompleteness",
      message: "Missing .gitignore file",
    });
  }

  if (checkPassed(results, "license_present")) {
    score += 2;
  } else if (
    checkEnabled(results, "license_present") &&
    !checkPassed(results, "license_present")
  ) {
    flags.push({
      severity: "info",
      category: "projectCompleteness",
      message: "No license file present",
    });
  }

  return { score: Math.max(0, Math.min(100, score)), flags };
}

function scoreDeploymentStatus(
  results: CheckResult[],
  projectType: string
): { score: number; flags: TrustFlag[] } {
  const flags: TrustFlag[] = [];

  // For hardware projects, deployment is less relevant
  if (projectType !== "software") {
    // Give a neutral score for hardware — deployment doesn't really apply
    return { score: 50, flags };
  }

  let score = 30; // baseline — no deployment info is below average

  const urlAlive = findCheck(results, "url_alive");
  if (urlAlive) {
    if (urlAlive.status === "pass") {
      score = 85;
    } else if (urlAlive.status === "warning") {
      score = 50;
      flags.push({
        severity: "warning",
        category: "deploymentStatus",
        message: "Deployed URL exists but may not be a real application",
      });
    } else if (urlAlive.status === "fail") {
      score = 15;
      flags.push({
        severity: "warning",
        category: "deploymentStatus",
        message: "Deployed URL is not accessible or not functional",
      });
    } else if (urlAlive.status === "skipped") {
      score = 40;
    }
  }

  // Package manager as deployment readiness signal
  if (checkPassed(results, "package_manager_present")) {
    score += 10;
  }

  return { score: Math.max(0, Math.min(100, score)), flags };
}

function scoreDevelopmentProcess(
  results: CheckResult[],
  forensics?: GitForensicsData
): { score: number; flags: TrustFlag[] } {
  const flags: TrustFlag[] = [];
  let score = 40; // baseline without forensics data

  if (!forensics) {
    flags.push({
      severity: "info",
      category: "developmentProcess",
      message:
        "No git forensics data available — cannot assess development process",
    });
    return { score, flags };
  }

  const totalCommits = forensics.commits.length;

  // Commit count scoring
  if (totalCommits >= 20) {
    score += 25;
  } else if (totalCommits >= 10) {
    score += 18;
  } else if (totalCommits >= 5) {
    score += 10;
  } else if (totalCommits <= 1) {
    score -= 20;
  }

  // Commit message quality — check for meaningful messages
  const meaningfulMessages = forensics.commits.filter((c) => {
    const msg = c.message.toLowerCase().trim();
    // Filter out generic/auto messages
    return (
      msg.length > 5 &&
      msg !== "initial commit" &&
      msg !== "first commit" &&
      msg !== "update" &&
      msg !== "fix" &&
      !msg.startsWith("update readme") &&
      !msg.match(/^commit [a-f0-9]+$/)
    );
  });

  const messageQualityRatio =
    totalCommits > 0 ? meaningfulMessages.length / totalCommits : 0;
  if (messageQualityRatio > 0.6) {
    score += 10;
  } else if (messageQualityRatio < 0.3 && totalCommits > 3) {
    flags.push({
      severity: "warning",
      category: "developmentProcess",
      message:
        "Most commit messages are generic — low commit message quality",
    });
    score -= 5;
  }

  // Commit time distribution
  if (forensics.commits.length >= 2) {
    const dates = forensics.commits.map((c) => new Date(c.date).getTime());
    const earliest = Math.min(...dates);
    const latest = Math.max(...dates);
    const spanDays = (latest - earliest) / (1000 * 60 * 60 * 24);

    if (spanDays >= 7) {
      score += 10;
    } else if (spanDays >= 2) {
      score += 5;
    } else if (spanDays < 1 && totalCommits > 5) {
      flags.push({
        severity: "warning",
        category: "developmentProcess",
        message:
          "All commits made within a single day — may indicate bulk upload",
      });
      score -= 5;
    }
  }

  // Check for fork status
  if (forensics.metadata.isFork) {
    flags.push({
      severity: "warning",
      category: "developmentProcess",
      message: `Repository is a fork of ${forensics.metadata.parentFullName || "another project"}`,
    });
    score -= 10;
  }

  // Archived or disabled
  if (forensics.metadata.archived) {
    flags.push({
      severity: "info",
      category: "developmentProcess",
      message: "Repository is archived",
    });
  }

  return { score: Math.max(0, Math.min(100, score)), flags };
}

// ── Main Trust Score Computation ──────────────────────────

export interface TrustScoreInput {
  checkResults: CheckResult[];
  projectType: string;
  forensics?: GitForensicsData;
  hourContext?: {
    hoursReported?: number;
    journalCount?: number;
  };
}

export function computeTrustScore(input: TrustScoreInput): TrustScore {
  const { checkResults, projectType, forensics, hourContext } = input;

  const weights =
    projectType === "software" ? SOFTWARE_WEIGHTS : HARDWARE_WEIGHTS;

  // Compute each category
  const authenticity = scoreCodeAuthenticity(
    checkResults,
    projectType,
    forensics
  );
  const effort = scoreEffortVerification(
    checkResults,
    projectType,
    forensics,
    hourContext
  );
  const completeness = scoreProjectCompleteness(checkResults, projectType);
  const deployment = scoreDeploymentStatus(checkResults, projectType);
  const process = scoreDevelopmentProcess(checkResults, forensics);

  // Weighted overall score
  const overall = Math.round(
    authenticity.score * weights.codeAuthenticity +
      effort.score * weights.effortVerification +
      completeness.score * weights.projectCompleteness +
      deployment.score * weights.deploymentStatus +
      process.score * weights.developmentProcess
  );

  // Collect all flags
  const flags: TrustFlag[] = [
    ...authenticity.flags,
    ...effort.flags,
    ...completeness.flags,
    ...deployment.flags,
    ...process.flags,
  ];

  // Critical flags can override category downward
  const criticalCount = flags.filter((f) => f.severity === "critical").length;
  let adjustedOverall = overall;
  if (criticalCount >= 2) {
    adjustedOverall = Math.min(adjustedOverall, 30);
  } else if (criticalCount === 1) {
    adjustedOverall = Math.min(adjustedOverall, 50);
  }

  const category = categorize(adjustedOverall);

  // Generate human-readable recommendation
  const recommendation = generateRecommendation(
    category,
    flags,
    adjustedOverall,
    {
      codeAuthenticity: authenticity.score,
      effortVerification: effort.score,
      projectCompleteness: completeness.score,
      deploymentStatus: deployment.score,
      developmentProcess: process.score,
    }
  );

  return {
    overall: adjustedOverall,
    category,
    breakdown: {
      codeAuthenticity: authenticity.score,
      effortVerification: effort.score,
      projectCompleteness: completeness.score,
      deploymentStatus: deployment.score,
      developmentProcess: process.score,
    },
    flags,
    recommendation,
  };
}

function generateRecommendation(
  category: TrustScore["category"],
  flags: TrustFlag[],
  overall: number,
  breakdown: TrustScore["breakdown"]
): string {
  const criticalFlags = flags.filter((f) => f.severity === "critical");
  const warningFlags = flags.filter((f) => f.severity === "warning");

  switch (category) {
    case "trusted":
      return "This project appears genuine with strong signals across all categories. Recommend approval with standard verification.";

    case "likely_genuine":
      if (warningFlags.length > 0) {
        return `Project looks genuine overall (score: ${overall}) but has ${warningFlags.length} minor concern(s): ${warningFlags.map((f) => f.message).join("; ")}. Recommend approval with noted caveats.`;
      }
      return `Project appears likely genuine (score: ${overall}). Recommend approval.`;

    case "needs_review": {
      const weakest = Object.entries(breakdown).sort(
        ([, a], [, b]) => a - b
      )[0];
      const weakestName = weakest[0]
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase();
      return `Project needs human review (score: ${overall}). Weakest area: ${weakestName} (${weakest[1]}/100). ${criticalFlags.length > 0 ? "Critical issues: " + criticalFlags.map((f) => f.message).join("; ") : ""}`.trim();
    }

    case "suspicious":
      return `Project is suspicious (score: ${overall}). ${criticalFlags.length} critical flag(s) detected. ${criticalFlags.map((f) => f.message).join("; ")}. Recommend rejection or deep manual review.`;

    case "rejected":
      return `Project does not meet minimum trust thresholds (score: ${overall}). ${criticalFlags.map((f) => f.message).join("; ")}. Recommend rejection.`;
  }
}
