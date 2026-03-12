import type { TrustScore } from "./trustScore.js";

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
  trustScore?: TrustScore;
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
  forensics?: GitForensicsData;
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

// ── Git Forensics Types ─────────────────────────────────

export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorLogin?: string;
  date: string; // ISO 8601
  committerName: string;
  committerEmail: string;
}

export interface CommitDetail {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorLogin?: string;
  date: string;
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
  files: Array<{
    filename: string;
    status: string; // "added" | "modified" | "removed" | "renamed"
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

export interface Contributor {
  login: string;
  contributions: number;
  type: string;
}

export interface RepoMetadata {
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  size: number; // KB
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  isFork: boolean;
  parentFullName?: string;
  description: string | null;
  language: string | null;
  topics: string[];
  hasWiki: boolean;
  hasPages: boolean;
  archived: boolean;
  disabled: boolean;
  visibility: string;
}

export interface WeeklyActivity {
  weekTimestamp: number; // Unix timestamp of the start of the week
  additions: number;
  deletions: number;
  commits: number;
}

// ── Extended RepoContext with optional forensics data ────

export interface GitForensicsData {
  commits: CommitInfo[];
  commitDetails: CommitDetail[]; // details for sampled commits
  contributors: Contributor[];
  metadata: RepoMetadata;
  weeklyActivity: WeeklyActivity[];
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
