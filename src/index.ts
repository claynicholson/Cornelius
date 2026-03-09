#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { printBanner, printSmallBanner, DIVIDER } from "./cli/branding.js";
import { formatReviewResult, formatBatchSummary } from "./cli/output.js";
import { reviewRepository } from "./core/reviewer.js";
import { readCsv } from "./batch/csvReader.js";
import { writeCsv, writeJson } from "./batch/csvWriter.js";
import { processBatch } from "./batch/processor.js";
import { isValidGitHubUrl } from "./github/parser.js";

const program = new Command();

program
  .name("cornelius")
  .description("Hack Club YSWS Submission Review Tool")
  .version("1.0.0");

// ── Single review ──────────────────────────────────────────
program
  .command("review <url>")
  .description("Review a single GitHub repository")
  .option("-p, --preset <name>", "Review preset to use", "default")
  .option("--no-ai", "Disable AI-powered checks")
  .action(async (url: string, opts: { preset: string; ai: boolean }) => {
    printBanner();

    if (!isValidGitHubUrl(url)) {
      console.log(chalk.red(`  ✘ Invalid GitHub URL: ${url}`));
      process.exit(1);
    }

    const spinner = ora({
      text: chalk.dim("  Scanning repository..."),
      color: "yellow",
    }).start();

    try {
      const result = await reviewRepository(url, {
        ghProxyApiKey: process.env.GH_PROXY_API_KEY,
        anthropicApiKey: opts.ai ? process.env.ANTHROPIC_API_KEY : undefined,
        preset: opts.preset,
      });

      spinner.stop();
      console.log(formatReviewResult(result));
      process.exit(result.overallPass ? 0 : 1);
    } catch (err) {
      spinner.fail(
        chalk.red(
          `  Failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      process.exit(1);
    }
  });

// ── Batch review ───────────────────────────────────────────
program
  .command("batch <csvFile>")
  .description("Review a batch of repositories from a CSV file")
  .option("-p, --preset <name>", "Review preset to use", "default")
  .option("-o, --output <file>", "Output file path", "results.csv")
  .option("-f, --format <type>", "Output format (csv or json)", "csv")
  .option("-c, --concurrency <n>", "Concurrent reviews", "5")
  .option("--no-ai", "Disable AI-powered checks")
  .action(
    async (
      csvFile: string,
      opts: {
        preset: string;
        output: string;
        format: string;
        concurrency: string;
        ai: boolean;
      }
    ) => {
      printSmallBanner();

      const spinner = ora({
        text: chalk.dim("  Reading CSV..."),
        color: "yellow",
      }).start();

      let rows;
      try {
        rows = await readCsv(csvFile);
      } catch (err) {
        spinner.fail(chalk.red(`  Failed to read CSV: ${err}`));
        process.exit(1);
      }

      spinner.succeed(
        chalk.green(`  Loaded ${rows.length} repositories from CSV`)
      );
      console.log(DIVIDER);

      const startTime = Date.now();

      const results = await processBatch(rows, {
        ghProxyApiKey: process.env.GH_PROXY_API_KEY,
        anthropicApiKey: opts.ai ? process.env.ANTHROPIC_API_KEY : undefined,
        preset: opts.preset,
        concurrency: parseInt(opts.concurrency, 10),
        onProgress: (completed, total, result) => {
          const pct = Math.round((completed / total) * 100);
          const icon = result.overallPass ? chalk.green("✔") : chalk.red("✘");
          console.log(
            `  ${icon} [${completed}/${total}] ${chalk.dim(`${pct}%`)} ${result.githubUrl}`
          );
        },
      });

      const elapsed = Date.now() - startTime;

      // Write output
      if (opts.format === "json") {
        writeJson(results, opts.output);
      } else {
        writeCsv(results, opts.output);
      }

      console.log(formatBatchSummary(
        results.map((r) => r.result),
        elapsed
      ));
      console.log(chalk.green(`  Results saved to ${opts.output}\n`));
    }
  );

// ── Info ───────────────────────────────────────────────────
program
  .command("info")
  .description("Show Cornelius configuration info")
  .action(() => {
    printBanner();
    console.log(`  ${chalk.bold("GH Proxy Key:")}    ${process.env.GH_PROXY_API_KEY ? chalk.green("configured") : chalk.red("not set")}`);
    console.log(`  ${chalk.bold("Anthropic Key:")}   ${process.env.ANTHROPIC_API_KEY ? chalk.green("configured") : chalk.red("not set")}`);
    console.log();
  });

program.parse();
