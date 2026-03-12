import { BaseCheck } from "./base.js";
import type {
  CheckConfig,
  CheckResult,
  RepoContext,
} from "../core/types.js";

export class RepoMetadataCheck extends BaseCheck {
  id = "repo_metadata";
  name = "Repository Metadata";
  description =
    "Provides context about the repository: age, activity, fork status, popularity, and description.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    if (!context.forensics?.metadata) {
      return this.skip(
        "Repository metadata not available (GitHub API data not loaded)",
        config
      );
    }

    const meta = context.forensics.metadata;
    const evidence: string[] = [];
    const warnings: string[] = [];

    // ── Repo Age ────────────────────────────────────────

    const createdAt = new Date(meta.createdAt);
    const pushedAt = new Date(meta.pushedAt);
    const now = new Date();
    const ageDays = Math.ceil(
      (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const lastPushDays = Math.ceil(
      (now.getTime() - pushedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    evidence.push(
      `Repository created: ${createdAt.toISOString().slice(0, 10)} (${ageDays} days ago)`
    );
    evidence.push(
      `Last push: ${pushedAt.toISOString().slice(0, 10)} (${lastPushDays} days ago)`
    );

    // ── Fork Status ─────────────────────────────────────

    if (meta.isFork) {
      const parentInfo = meta.parentFullName
        ? ` of ${meta.parentFullName}`
        : "";
      evidence.push(`Repository is a fork${parentInfo}`);
      warnings.push(
        `This repository is a fork${parentInfo} - verify the submission contains original work`
      );
    } else {
      evidence.push("Repository is not a fork");
    }

    // ── Popularity (stars/forks) ────────────────────────

    evidence.push(
      `Stars: ${meta.stargazersCount}, Forks: ${meta.forksCount}`
    );

    if (meta.stargazersCount > 100) {
      warnings.push(
        `Repository has ${meta.stargazersCount} stars - this may be a pre-existing popular project, not a new YSWS submission`
      );
    } else if (meta.stargazersCount > 20) {
      warnings.push(
        `Repository has ${meta.stargazersCount} stars - verify this is a new submission and not an existing project`
      );
    }

    if (meta.forksCount > 20) {
      warnings.push(
        `Repository has ${meta.forksCount} forks - may be a well-known project`
      );
    }

    // ── Description ─────────────────────────────────────

    if (meta.description) {
      evidence.push(`Description: ${meta.description}`);
    } else {
      evidence.push("No repository description set");
    }

    // ── Language & Topics ───────────────────────────────

    if (meta.language) {
      evidence.push(`Primary language: ${meta.language}`);
    }

    if (meta.topics.length > 0) {
      evidence.push(`Topics: ${meta.topics.join(", ")}`);
    }

    // ── Size ────────────────────────────────────────────

    const sizeFormatted =
      meta.size > 1024
        ? `${(meta.size / 1024).toFixed(1)} MB`
        : `${meta.size} KB`;
    evidence.push(`Repository size: ${sizeFormatted}`);

    // ── Archived/Disabled ───────────────────────────────

    if (meta.archived) {
      evidence.push("Repository is archived");
      warnings.push("Repository is archived - may not be actively maintained");
    }

    if (meta.disabled) {
      evidence.push("Repository is disabled");
      warnings.push("Repository is disabled by GitHub");
    }

    // ── Deployment Indicators ───────────────────────────

    if (meta.hasPages) {
      evidence.push("GitHub Pages is enabled");
    }

    // ── Determine Status ────────────────────────────────

    // This check is informational but flags concerns
    if (meta.isFork || meta.stargazersCount > 100) {
      return {
        checkName: this.id,
        required: config.required ?? false,
        status: config.severity === "warning" ? "warning" : "fail",
        confidence: 0.9,
        evidence,
        reason:
          warnings.length > 0
            ? warnings.join(". ")
            : "Repository metadata raises concerns",
        aiUsed: false,
      };
    }

    if (warnings.length > 0) {
      return {
        checkName: this.id,
        required: config.required ?? false,
        status: "warning",
        confidence: 0.8,
        evidence,
        reason: warnings.join(". "),
        aiUsed: false,
      };
    }

    return this.pass(
      `Repository metadata looks normal: ${ageDays} days old, ${meta.stargazersCount} stars, not a fork`,
      evidence,
      config
    );
  }
}
