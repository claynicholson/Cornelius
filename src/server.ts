import "dotenv/config";
import express from "express";
import multer from "multer";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { reviewRepository } from "./core/reviewer.js";
import { readCsv } from "./batch/csvReader.js";
import { processBatch } from "./batch/processor.js";
import { isValidGitHubUrl } from "./github/parser.js";
import { writeFileSync, unlinkSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.static(resolve(__dirname, "web/public")));

// ── Single review ──────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { url, preset } = req.body;

  if (!url || !isValidGitHubUrl(url)) {
    res.status(400).json({ error: "Invalid GitHub URL" });
    return;
  }

  try {
    const result = await reviewRepository(url, {
      ghProxyApiKey: process.env.GH_PROXY_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      preset: preset || "default",
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Review failed",
    });
  }
});

// ── Batch review ───────────────────────────────────────────
const batchJobs = new Map<
  string,
  { status: string; results: unknown[]; total: number; completed: number }
>();

app.post("/api/batch", upload.single("csv"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No CSV file uploaded" });
    return;
  }

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const preset = req.body?.preset || "default";

  batchJobs.set(jobId, { status: "processing", results: [], total: 0, completed: 0 });

  res.json({ jobId, status: "processing" });

  // Process in background
  try {
    const rows = await readCsv(req.file.path);
    const job = batchJobs.get(jobId)!;
    job.total = rows.length;

    const results = await processBatch(rows, {
      ghProxyApiKey: process.env.GH_PROXY_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      preset,
      concurrency: 5,
      onProgress: (completed) => {
        job.completed = completed;
      },
    });

    job.status = "complete";
    job.results = results;

    // Cleanup upload
    try { unlinkSync(req.file!.path); } catch {}
  } catch (err) {
    const job = batchJobs.get(jobId);
    if (job) {
      job.status = "error";
    }
  }
});

app.get("/api/batch/:jobId", (req, res) => {
  const job = batchJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// ── Health ─────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    github: !!process.env.GH_PROXY_API_KEY,
    ai: !!process.env.ANTHROPIC_API_KEY,
  });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`
  ╔═╗╔═╗╦═╗╔╗╔╔═╗╦  ╦╦ ╦╔═╗
  ║  ║ ║╠╦╝║║║║╣ ║  ║║ ║╚═╗
  ╚═╝╚═╝╩╚═╝╚╝╚═╝╩═╝╩╚═╝╚═╝
  ─── YSWS Review Engine ───

  Server running on http://localhost:${PORT}
  `);
});
