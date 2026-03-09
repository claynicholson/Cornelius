import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

const ACCEPTED_FILENAMES = [
  "readme.md",
  "readme",
  "readme.txt",
  "readme.rst",
  "readme.adoc",
];

export class ReadmePresentCheck extends BaseCheck {
  id = "readme_present";
  name = "README Present";
  description = "Checks that a README file exists in the repository.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const readmeFiles = context.tree
      .filter((e) => e.type === "blob")
      .filter((e) => {
        const filename = e.path.split("/").pop()?.toLowerCase() || "";
        return ACCEPTED_FILENAMES.includes(filename);
      });

    if (readmeFiles.length === 0) {
      return this.fail(
        "No README file found in the repository",
        [],
        config
      );
    }

    const rootReadme = readmeFiles.find((f) => !f.path.includes("/"));

    if (rootReadme) {
      return this.pass(
        "README found at repository root",
        [rootReadme.path],
        config
      );
    }

    return this.warn(
      "README found but not at repository root",
      readmeFiles.map((f) => f.path),
      config
    );
  }
}
