export interface CheckResult {
  checkName: string;
  required: boolean;
  status: "pass" | "fail" | "warning" | "error" | "skipped";
  confidence: number;
  evidence: string[];
  reason: string;
  aiUsed: boolean;
}

export interface ReviewResult {
  githubUrl: string;
  status: "pass" | "fail" | "warning" | "error";
  overallPass: boolean;
  checkResults: CheckResult[];
  warnings: string[];
  errors: string[];
  aiSummary?: string;
  suggestedFixes?: string[];
  submissionId?: string;
  participantName?: string;
  confidenceScore: number;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export interface RepoContext {
  owner: string;
  repo: string;
  url: string;
  tree: TreeEntry[];
  readme: string | null;
  defaultBranch: string;
  getFile: (path: string) => Promise<string | null>;
}

export interface CheckConfig {
  enabled: boolean;
  required: boolean;
  severity?: "fail" | "warning";
  [key: string]: unknown;
}

export interface Check {
  id: string;
  name: string;
  description: string;
  run(context: RepoContext, config: CheckConfig): Promise<CheckResult>;
}

export interface PresetConfig {
  name: string;
  projectType: string;
  checks: Record<string, CheckConfig>;
}

export interface BatchRow {
  github_url: string;
  project_type?: string;
  program_preset?: string;
  submission_id?: string;
  participant_name?: string;
  email?: string;
  notes?: string;
}

export interface BatchResult {
  submissionId: string;
  githubUrl: string;
  projectType: string;
  overallStatus: string;
  passedChecks: string[];
  failedChecks: string[];
  warnings: string[];
  reviewSummary: string;
  confidenceScore: number;
  result: ReviewResult;
}
