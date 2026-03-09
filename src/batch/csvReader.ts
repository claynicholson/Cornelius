import { createReadStream } from "fs";
import { parse } from "csv-parse";
import type { BatchRow } from "../core/types.js";

export async function readCsv(filePath: string): Promise<BatchRow[]> {
  return new Promise((resolve, reject) => {
    const rows: BatchRow[] = [];

    createReadStream(filePath)
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      )
      .on("data", (row: Record<string, string>) => {
        const githubUrl = row.github_url || row.url || row.GitHub_URL || row.repo;
        if (githubUrl) {
          rows.push({
            github_url: githubUrl,
            project_type: row.project_type || row.type || "hardware",
            program_preset: row.program_preset || row.preset,
            submission_id: row.submission_id || row.id,
            participant_name: row.participant_name || row.name,
            email: row.email,
            notes: row.notes,
          });
        }
      })
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}
