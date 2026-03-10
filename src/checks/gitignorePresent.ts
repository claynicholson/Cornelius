import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

export class GitignoreCheck extends BaseCheck {
  id = "gitignore_present";
  name = ".gitignore Present";
  description = "Checks for a .gitignore file to prevent committing build artifacts.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const found = context.tree.some(
      (e) => e.type === "blob" && e.path === ".gitignore",
    );

    if (found) {
      return this.pass("Repository has a .gitignore file", [".gitignore"], config);
    }

    return this.warn(
      "No .gitignore file found — build artifacts and dependencies may be committed",
      [],
      config,
    );
  }
}
