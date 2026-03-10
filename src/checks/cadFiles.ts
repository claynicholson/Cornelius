import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

const DEFAULT_3D_EXTENSIONS = [
  ".stl",
  ".step",
  ".stp",
  ".3mf",
  ".obj",
  ".f3d",
  ".fcstd",
  ".scad",
];

const PCB_EXTENSIONS = [
  ".kicad_pro", ".kicad_sch", ".kicad_pcb",
  ".epro", ".eprj",
  ".sch", ".brd",
  ".prjpcb", ".schdoc", ".pcbdoc",
  ".gbr", ".ger", ".gtl", ".gbl", ".gts", ".gbs",
  ".gto", ".gbo", ".gtp", ".gbp", ".gm1", ".drl",
];

export class CadFilesCheck extends BaseCheck {
  id = "three_d_files_present";
  name = "3D Design Files Present";
  description = "Checks that 3D design files exist in the repository.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const extensions = (config.allowed_extensions as string[]) || DEFAULT_3D_EXTENSIONS;
    const minCount = (config.minimum_file_count as number) || 1;

    const found = this.findFiles(context.tree, extensions);

    if (found.length === 0) {
      // PCB-only projects shouldn't be failed for missing 3D files
      const pcbFiles = this.findFiles(context.tree, PCB_EXTENSIONS);
      if (pcbFiles.length > 0) {
        return this.pass(
          "PCB-only project detected — 3D design files not expected",
          [],
          config,
        );
      }

      return this.fail(
        `No 3D design files found (looked for: ${extensions.join(", ")})`,
        [],
        config
      );
    }

    if (found.length < minCount) {
      return this.warn(
        `Found ${found.length} 3D file(s) but expected at least ${minCount}`,
        found,
        config
      );
    }

    const hasSource = found.some((f) =>
      [".f3d", ".fcstd", ".scad", ".step", ".stp"].some((ext) =>
        f.toLowerCase().endsWith(ext)
      )
    );

    const hasExport = found.some((f) =>
      [".stl", ".3mf", ".obj"].some((ext) =>
        f.toLowerCase().endsWith(ext)
      )
    );

    const evidence = found.slice(0, 10);
    if (hasSource && hasExport) {
      return this.pass(
        `Found ${found.length} 3D file(s) including both source and export formats`,
        evidence,
        config
      );
    }

    return this.pass(
      `Found ${found.length} 3D design file(s)`,
      evidence,
      config
    );
  }
}
