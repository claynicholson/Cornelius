import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

export class RepoAliveCheck extends BaseCheck {
  id = "github_link_works";
  name = "GitHub Link Works";
  description = "Checks that the GitHub URL is reachable and points to a valid repository.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    try {
      if (!context.owner || !context.repo) {
        return this.fail("Invalid GitHub URL format", [], config);
      }

      if (context.tree.length === 0) {
        return this.fail(
          "Repository exists but appears empty",
          [context.url],
          config
        );
      }

      return this.pass(
        "Repository is accessible and contains files",
        [context.url, `${context.tree.length} files found`],
        config
      );
    } catch {
      return this.error("Failed to access repository", config);
    }
  }
}
