import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

const LICENSE_NAMES = [
  "license", "license.md", "license.txt", "license.rst",
  "licence", "licence.md", "licence.txt",
  "copying", "copying.md", "copying.txt",
];

export class LicensePresentCheck extends BaseCheck {
  id = "license_present";
  name = "License Present";
  description = "Checks for a LICENSE or COPYING file in the repository.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const found = context.tree.find(
      (e) =>
        e.type === "blob" &&
        LICENSE_NAMES.includes(e.path.toLowerCase()),
    );

    if (found) {
      return this.pass(`License file found: ${found.path}`, [found.path], config);
    }

    return this.warn(
      "No license file found — consider adding one for open-source sharing",
      [],
      config,
    );
  }
}
