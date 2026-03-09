import type { Check, CheckConfig, CheckResult, RepoContext } from "../core/types.js";

export abstract class BaseCheck implements Check {
  abstract id: string;
  abstract name: string;
  abstract description: string;

  abstract run(context: RepoContext, config: CheckConfig): Promise<CheckResult>;

  protected pass(reason: string, evidence: string[] = [], config?: CheckConfig): CheckResult {
    return {
      checkName: this.id,
      required: config?.required ?? true,
      status: "pass",
      confidence: 1.0,
      evidence,
      reason,
      aiUsed: false,
    };
  }

  protected fail(reason: string, evidence: string[] = [], config?: CheckConfig): CheckResult {
    return {
      checkName: this.id,
      required: config?.required ?? true,
      status: config?.severity === "warning" ? "warning" : "fail",
      confidence: 1.0,
      evidence,
      reason,
      aiUsed: false,
    };
  }

  protected warn(reason: string, evidence: string[] = [], config?: CheckConfig): CheckResult {
    return {
      checkName: this.id,
      required: config?.required ?? false,
      status: "warning",
      confidence: 0.8,
      evidence,
      reason,
      aiUsed: false,
    };
  }

  protected skip(reason: string, config?: CheckConfig): CheckResult {
    return {
      checkName: this.id,
      required: config?.required ?? false,
      status: "skipped",
      confidence: 1.0,
      evidence: [],
      reason,
      aiUsed: false,
    };
  }

  protected error(reason: string, config?: CheckConfig): CheckResult {
    return {
      checkName: this.id,
      required: config?.required ?? true,
      status: "error",
      confidence: 0,
      evidence: [],
      reason,
      aiUsed: false,
    };
  }

  protected findFiles(tree: RepoContext["tree"], extensions: string[]): string[] {
    const lowerExts = extensions.map((e) => e.toLowerCase());
    return tree
      .filter((e) => e.type === "blob")
      .filter((e) => lowerExts.some((ext) => e.path.toLowerCase().endsWith(ext)))
      .map((e) => e.path);
  }
}
