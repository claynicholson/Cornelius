import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

interface EcadTool {
  name: string;
  sourcePatterns: string[];
  outputPatterns: string[];
}

const ECAD_TOOLS: EcadTool[] = [
  {
    name: "KiCad",
    sourcePatterns: [".kicad_pro", ".kicad_sch", ".kicad_pcb"],
    outputPatterns: [".kicad_prl", ".kicad_sym"],
  },
  {
    name: "EasyEDA",
    sourcePatterns: [".epro", ".eprj"],
    outputPatterns: [],
  },
  {
    name: "Eagle",
    sourcePatterns: [".sch", ".brd"],
    outputPatterns: [],
  },
  {
    name: "Altium",
    sourcePatterns: [".PrjPcb", ".SchDoc", ".PcbDoc"],
    outputPatterns: [],
  },
];

const GERBER_EXTENSIONS = [
  ".gbr", ".ger", ".gtl", ".gbl", ".gts", ".gbs",
  ".gto", ".gbo", ".gtp", ".gbp", ".gm1", ".drl",
];

export class PcbFilesCheck extends BaseCheck {
  id = "pcb_files_present";
  name = "PCB Design Files Present";
  description = "Checks that PCB design files are present and appear sufficient.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const blobs = context.tree.filter((e) => e.type === "blob").map((e) => e.path);

    const detectedTools: { tool: EcadTool; sourceFiles: string[]; outputFiles: string[] }[] = [];

    for (const tool of ECAD_TOOLS) {
      const sourceFiles = blobs.filter((f) =>
        tool.sourcePatterns.some((pat) => f.toLowerCase().endsWith(pat.toLowerCase()))
      );
      const outputFiles = blobs.filter((f) =>
        tool.outputPatterns.some((pat) => f.toLowerCase().endsWith(pat.toLowerCase()))
      );

      if (sourceFiles.length > 0) {
        detectedTools.push({ tool, sourceFiles, outputFiles });
      }
    }

    const gerbers = blobs.filter((f) =>
      GERBER_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext))
    );

    if (detectedTools.length === 0 && gerbers.length === 0) {
      return this.fail(
        "No PCB design files found (no KiCad, EasyEDA, Eagle, Altium, or Gerber files detected)",
        [],
        config
      );
    }

    const evidence: string[] = [];

    if (detectedTools.length > 0) {
      for (const dt of detectedTools) {
        evidence.push(`${dt.tool.name}: ${dt.sourceFiles.join(", ")}`);

        const expectedSources = dt.tool.sourcePatterns;
        const foundPatterns = expectedSources.filter((pat) =>
          dt.sourceFiles.some((f) => f.toLowerCase().endsWith(pat.toLowerCase()))
        );

        if (foundPatterns.length < expectedSources.length) {
          const missing = expectedSources.filter(
            (p) => !foundPatterns.includes(p)
          );
          return this.warn(
            `${dt.tool.name} project detected but potentially incomplete. Missing: ${missing.join(", ")}`,
            evidence,
            config
          );
        }
      }

      const toolNames = detectedTools.map((d) => d.tool.name).join(", ");
      return this.pass(
        `PCB design files found for: ${toolNames}`,
        evidence,
        config
      );
    }

    if (gerbers.length > 0) {
      const requireSource = config.require_source_design_files as boolean;
      if (requireSource) {
        return this.warn(
          `Only Gerber/manufacturing files found (${gerbers.length} files). Source design files recommended.`,
          gerbers.slice(0, 10),
          config
        );
      }
      return this.pass(
        `Found ${gerbers.length} Gerber/manufacturing file(s)`,
        gerbers.slice(0, 10),
        config
      );
    }

    return this.fail("No PCB design files detected", [], config);
  }
}
