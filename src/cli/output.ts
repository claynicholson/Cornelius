import chalk from "chalk";
import Table from "cli-table3";
import type { ReviewResult, CheckResult } from "../core/types.js";
import { STATUS_ICONS, DIVIDER } from "./branding.js";

export function formatCheckResult(result: CheckResult): string {
  const icon = STATUS_ICONS[result.status];
  const ai = result.aiUsed ? chalk.magenta(" [AI]") : "";
  const required = result.required ? chalk.dim(" (required)") : chalk.dim(" (optional)");

  let output = `  ${icon}  ${chalk.bold(result.checkName)}${required}${ai}\n`;
  output += `         ${chalk.dim(result.reason)}\n`;

  if (result.evidence.length > 0) {
    for (const ev of result.evidence.slice(0, 3)) {
      output += `         ${chalk.dim("→")} ${chalk.dim(ev)}\n`;
    }
    if (result.evidence.length > 3) {
      output += `         ${chalk.dim(`  ...and ${result.evidence.length - 3} more`)}\n`;
    }
  }

  return output;
}

export function formatReviewResult(result: ReviewResult): string {
  let output = "\n";

  // Header
  const statusColor = result.overallPass ? chalk.green : chalk.red;
  output += `  ${chalk.bold("Repository:")} ${chalk.cyan(result.githubUrl)}\n`;
  output += `  ${chalk.bold("Status:")}     ${statusColor(result.overallPass ? "PASSED" : "FAILED")}\n`;
  output += `  ${chalk.bold("Confidence:")} ${chalk.white(Math.round(result.confidenceScore * 100) + "%")}\n`;
  output += `\n${DIVIDER}\n\n`;

  // Check results
  output += `  ${chalk.bold.underline("Check Results")}\n\n`;
  for (const check of result.checkResults) {
    output += formatCheckResult(check);
    output += "\n";
  }

  // Summary
  output += DIVIDER + "\n\n";

  const passed = result.checkResults.filter((c) => c.status === "pass").length;
  const failed = result.checkResults.filter(
    (c) => c.status === "fail" || c.status === "error"
  ).length;
  const warned = result.checkResults.filter((c) => c.status === "warning").length;
  const skipped = result.checkResults.filter((c) => c.status === "skipped").length;

  output += `  ${chalk.green(`${passed} passed`)}  ${chalk.red(`${failed} failed`)}  ${chalk.yellow(`${warned} warnings`)}  ${chalk.gray(`${skipped} skipped`)}\n`;

  // AI Summary
  if (result.aiSummary) {
    output += `\n  ${chalk.bold("AI Summary:")}\n`;
    output += `  ${chalk.dim(result.aiSummary)}\n`;
  }

  // Suggested fixes
  if (result.suggestedFixes && result.suggestedFixes.length > 0) {
    output += `\n  ${chalk.bold("Suggested Fixes:")}\n`;
    for (const fix of result.suggestedFixes) {
      output += `  ${chalk.yellow("→")} ${fix}\n`;
    }
  }

  output += "\n";
  return output;
}

export function formatBatchSummary(
  results: ReviewResult[],
  elapsed: number
): string {
  const passed = results.filter((r) => r.overallPass).length;
  const failed = results.filter((r) => !r.overallPass).length;
  const errors = results.filter((r) => r.status === "error").length;

  let output = `\n${DIVIDER}\n`;
  output += `  ${chalk.bold.underline("Batch Summary")}\n\n`;

  const table = new Table({
    head: [
      chalk.white("Metric"),
      chalk.white("Count"),
    ],
    style: { head: [], border: ["gray"] },
  });

  table.push(
    ["Total Repositories", String(results.length)],
    [chalk.green("Passed"), String(passed)],
    [chalk.red("Failed"), String(failed)],
    [chalk.red("Errors"), String(errors)],
    ["Time Elapsed", `${(elapsed / 1000).toFixed(1)}s`],
    ["Pass Rate", `${results.length > 0 ? Math.round((passed / results.length) * 100) : 0}%`]
  );

  output += table.toString() + "\n";
  return output;
}
