import { Worker } from "worker_threads";
import { cpus } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { BatchRow, BatchResult, ReviewResult } from "../core/types.js";
import { reviewRepository, type ReviewOptions, type HourContext } from "../core/reviewer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BatchOptions extends ReviewOptions {
  concurrency?: number;
  useWorkers?: boolean;
  onProgress?: (completed: number, total: number, result: ReviewResult) => void;
}

// ── Worker Pool ────────────────────────────────────────────
interface PendingTask {
  row: BatchRow;
  index: number;
  resolve: (result: BatchResult) => void;
  reject: (err: Error) => void;
}

class WorkerPool {
  private workers: Worker[] = [];
  private queue: PendingTask[] = [];
  private activeByWorker = new Map<Worker, PendingTask>();
  private options: BatchOptions;
  private completed = 0;
  private total = 0;

  constructor(size: number, workerPath: string, options: BatchOptions) {
    this.options = options;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath, {
        execArgv: ["--loader", "tsx"],
      });
      this.workers.push(worker);

      worker.on("message", (msg) => {
        const pending = this.activeByWorker.get(worker);
        if (!pending) return;

        this.activeByWorker.delete(worker);
        this.completed++;

        if (msg.type === "result") {
          const result = msg.result as ReviewResult;

          if (this.options.onProgress) {
            this.options.onProgress(this.completed, this.total, result);
          }

          pending.resolve(this.toBatchResult(pending.row, pending.index, result));
        } else {
          const errResult: ReviewResult = {
            githubUrl: pending.row.github_url,
            status: "error",
            overallPass: false,
            checkResults: [],
            warnings: [],
            errors: [msg.error || "Worker error"],
            confidenceScore: 0,
          };

          if (this.options.onProgress) {
            this.options.onProgress(this.completed, this.total, errResult);
          }

          pending.resolve(this.toBatchResult(pending.row, pending.index, errResult));
        }

        this.dispatch(worker);
      });

      worker.on("error", (err) => {
        const pending = this.activeByWorker.get(worker);
        if (pending) {
          this.activeByWorker.delete(worker);
          this.completed++;
          const errResult: ReviewResult = {
            githubUrl: pending.row.github_url,
            status: "error",
            overallPass: false,
            checkResults: [],
            warnings: [],
            errors: [`Worker crashed: ${err.message}`],
            confidenceScore: 0,
          };

          if (this.options.onProgress) {
            this.options.onProgress(this.completed, this.total, errResult);
          }

          pending.resolve(this.toBatchResult(pending.row, pending.index, errResult));
        }

        this.dispatch(worker);
      });
    }
  }

  private dispatch(worker: Worker) {
    const task = this.queue.shift();
    if (!task) return;

    this.activeByWorker.set(worker, task);

    const hourContext: HourContext | undefined =
      task.row.hours_reported != null || task.row.journal
        ? {
            hoursReported: task.row.hours_reported,
            journalCount: task.row.journal_count,
            journal: task.row.journal,
          }
        : undefined;

    worker.postMessage({
      url: task.row.github_url,
      options: {
        ghProxyApiKey: this.options.ghProxyApiKey,
        anthropicApiKey: this.options.anthropicApiKey,
        preset: task.row.program_preset || this.options.preset,
        hourContext,
      },
    });
  }

  submit(rows: BatchRow[]): Promise<BatchResult[]> {
    this.total = rows.length;
    this.completed = 0;

    const promises = rows.map(
      (row, index) =>
        new Promise<BatchResult>((resolve, reject) => {
          this.queue.push({ row, index, resolve, reject });
        })
    );

    // Kick off initial work for each idle worker
    for (const worker of this.workers) {
      if (!this.activeByWorker.has(worker)) {
        this.dispatch(worker);
      }
    }

    return Promise.all(promises);
  }

  private toBatchResult(row: BatchRow, index: number, result: ReviewResult): BatchResult {
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
      hourEstimate: result.hourEstimate,
      hourJustification: result.hourJustification,
      result,
    };
  }

  async terminate() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

// ── Single-threaded fallback ───────────────────────────────
async function processSingleThreaded(
  rows: BatchRow[],
  options: BatchOptions
): Promise<BatchResult[]> {
  const concurrency = options.concurrency || 5;
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(concurrency);

  let completed = 0;
  const total = rows.length;

  const promises = rows.map((row, index) =>
    limit(async (): Promise<BatchResult> => {
      const reviewOpts: ReviewOptions = {
        ...options,
        preset: row.program_preset || options.preset,
        hourContext: {
          hoursReported: row.hours_reported,
          journalCount: row.journal_count,
          journal: row.journal,
        },
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
        hourEstimate: result.hourEstimate,
        hourJustification: result.hourJustification,
        result,
      };
    })
  );

  return Promise.all(promises);
}

// ── Public API ─────────────────────────────────────────────
export async function processBatch(
  rows: BatchRow[],
  options: BatchOptions = {}
): Promise<BatchResult[]> {
  // Use workers for batches > 10 rows by default, or when explicitly requested
  const useWorkers = options.useWorkers ?? rows.length > 10;

  if (!useWorkers) {
    return processSingleThreaded(rows, options);
  }

  // Worker count: min(cpu cores - 1, concurrency, row count), at least 1
  const maxWorkers = Math.max(1, cpus().length - 1);
  const concurrency = options.concurrency || 5;
  const workerCount = Math.min(maxWorkers, concurrency, rows.length);

  const workerPath = resolve(__dirname, "worker.ts");

  const pool = new WorkerPool(workerCount, workerPath, options);

  try {
    return await pool.submit(rows);
  } finally {
    await pool.terminate();
  }
}
