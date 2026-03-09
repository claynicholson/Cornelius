import pLimit from "p-limit";
import type { BatchRow, BatchResult, ReviewResult } from "../core/types.js";
import { reviewRepository, type ReviewOptions } from "../core/reviewer.js";

export interface BatchOptions extends ReviewOptions {
  concurrency?: number;
  onProgress?: (completed: number, total: number, result: ReviewResult) => void;
}

export async function processBatch(
  rows: BatchRow[],
  options: BatchOptions = {}
): Promise<BatchResult[]> {
  const concurrency = options.concurrency || 5;
  const limit = pLimit(concurrency);

  let completed = 0;
  const total = rows.length;

  const promises = rows.map((row, index) =>
    limit(async (): Promise<BatchResult> => {
      const reviewOpts: ReviewOptions = {
        ...options,
        preset: row.program_preset || options.preset,
      };

      const result = await reviewRepository(row.github_url, reviewOpts);

      completed++;
      if (options.onProgress) {
        options.onProgress(completed, total, result);
      }

      return {
        submissionId: row.submission_id || String(index + 1),
        githubUrl: row.github_url,
        projectType: row.project_type || "hardware",
        overallStatus: result.status,
        passedChecks: result.checkResults
          .filter((c) => c.status === "pass")
          .map((c) => c.checkName),
        failedChecks: result.checkResults
          .filter((c) => c.status === "fail" || c.status === "error")
          .map((c) => c.checkName),
        warnings: result.warnings,
        reviewSummary: result.aiSummary || result.status,
        confidenceScore: result.confidenceScore,
        result,
      };
    })
  );

  return Promise.all(promises);
}
