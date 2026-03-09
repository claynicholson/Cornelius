import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

const BOM_FILENAMES = [
  "bom.csv",
  "bom.xlsx",
  "bom.tsv",
  "parts.csv",
  "bill_of_materials.csv",
  "bom.json",
  "bom.ods",
];

const BOM_DIRECTORIES = [
  "",
  "docs/",
  "hardware/",
  "pcb/",
  "electronics/",
  "manufacturing/",
];

export class BomPresentCheck extends BaseCheck {
  id = "bom_present_if_required";
  name = "BOM Present";
  description = "Checks that a bill of materials exists when required.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const blobs = context.tree
      .filter((e) => e.type === "blob")
      .map((e) => e.path);

    const bomFiles: string[] = [];

    for (const file of blobs) {
      const filename = file.split("/").pop()?.toLowerCase() || "";
      if (BOM_FILENAMES.includes(filename)) {
        bomFiles.push(file);
      }
    }

    // Also check for BOM-like patterns in filenames
    const bomPatternFiles = blobs.filter((f) => {
      const lower = f.toLowerCase();
      return (
        lower.includes("bom") ||
        lower.includes("bill_of_materials") ||
        lower.includes("bill-of-materials") ||
        lower.includes("parts_list") ||
        lower.includes("parts-list")
      );
    });

    const allBomFiles = [...new Set([...bomFiles, ...bomPatternFiles])];

    if (allBomFiles.length > 0) {
      return this.pass(
        `Bill of materials found: ${allBomFiles.length} file(s)`,
        allBomFiles,
        config
      );
    }

    // Check if README mentions BOM inline
    if (context.readme) {
      const readmeLower = context.readme.toLowerCase();
      if (
        readmeLower.includes("bill of materials") ||
        readmeLower.includes("## bom") ||
        readmeLower.includes("# bom") ||
        readmeLower.includes("parts list")
      ) {
        return this.pass(
          "BOM appears to be included in the README",
          ["README contains BOM section"],
          config
        );
      }
    }

    if (!config.required) {
      return this.skip("BOM not required for this preset", config);
    }

    return this.fail(
      "No bill of materials found",
      [`Looked in: ${BOM_DIRECTORIES.map((d) => d || "/").join(", ")}`],
      config
    );
  }
}
