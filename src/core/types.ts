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
  hourEstimate?: number;
  hourJustification?: string;
  apiCost?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number; // USD
    callCount: number;
  };
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
  prompt?: string;
  url?: string;
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
  instructions?: string;
  maxBudget?: number;
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
  hours_reported?: number;
  journal_count?: number;
  journal?: string;
  playable_url?: string;
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
  hourEstimate?: number;
  hourJustification?: string;
  result: ReviewResult;
}

export interface UserSession {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  ghApiToken?: string;
  anthropicApiKey?: string;
  customPresets: Record<string, PresetConfig>;
}
