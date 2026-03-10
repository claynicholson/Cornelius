import { writeFileSync } from "fs";
import { stringify } from "csv-stringify/sync";
import type { BatchResult } from "../core/types.js";

export function writeCsv(results: BatchResult[], outputPath: string): void {
  const rows = results.map((r) => ({
    submission_id: r.submissionId,
    github_url: r.githubUrl,
    project_type: r.projectType,
    overall_status: r.overallStatus,
    passed_checks: r.passedChecks.join("; "),
    failed_checks: r.failedChecks.join("; "),
    warnings: r.warnings.join("; "),
    review_summary: r.reviewSummary,
    confidence_score: r.confidenceScore,
    hour_estimate: r.hourEstimate ?? "",
    hour_justification: r.hourJustification ?? "",
  }));

  const csv = stringify(rows, { header: true });
  writeFileSync(outputPath, csv, "utf-8");
}

export function writeJson(results: BatchResult[], outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");
}
