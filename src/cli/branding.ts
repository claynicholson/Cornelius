import chalk from "chalk";

export const LOGO = `
${chalk.yellow(`
      ████████████████████████████████████
      █                                  █
      █   ██████╗ ██████╗ ██████╗ ███╗   █
      █  ██╔════╝██╔═══██╗██╔══██╗████╗  █
      █  ██║     ██║   ██║██████╔╝██╔██╗ █
      █  ██║     ██║   ██║██╔══██╗██║╚██╗█
      █  ╚██████╗╚██████╔╝██║  ██║██║ ╚████
      █   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ███
      █                                  █
      █  ███████╗██╗     ██╗██╗   ██╗███████
      █  ██╔════╝██║     ██║██║   ██║██╔════█
      █  █████╗  ██║     ██║██║   ██║███████╗█
      █  ██╔══╝  ██║     ██║██║   ██║╚════██║█
      █  ███████╗███████╗██║╚██████╔╝███████║█
      █  ╚══════╝╚══════╝╚═╝ ╚═════╝ ╚══════╝
      █                                  █
      ████████████████████████████████████
`)}
${chalk.gray("─".repeat(50))}
${chalk.bold.white("  CORNELIUS")} ${chalk.gray("v1.0.0")}
${chalk.cyan("  Hack Club YSWS Submission Reviewer")}
${chalk.gray("─".repeat(50))}
`;

export const LOGO_SMALL = `
${chalk.yellow("  ╔═╗╔═╗╦═╗╔╗╔╔═╗╦  ╦╦ ╦╔═╗")}
${chalk.yellow("  ║  ║ ║╠╦╝║║║║╣ ║  ║║ ║╚═╗")}
${chalk.yellow("  ╚═╝╚═╝╩╚═╝╚╝╚═╝╩═╝╩╚═╝╚═╝")}
${chalk.gray("  ─── YSWS Review Engine ───")}
`;

export const STATUS_ICONS = {
  pass: chalk.green("✔ PASS"),
  fail: chalk.red("✘ FAIL"),
  warning: chalk.yellow("⚠ WARN"),
  error: chalk.red("⊘ ERR "),
  skipped: chalk.gray("⊘ SKIP"),
} as const;

export const DIVIDER = chalk.gray("─".repeat(50));

export function printBanner() {
  console.log(LOGO);
}

export function printSmallBanner() {
  console.log(LOGO_SMALL);
}
