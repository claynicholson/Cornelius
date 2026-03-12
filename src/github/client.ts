import type {
  TreeEntry,
  CommitInfo,
  CommitDetail,
  Contributor,
  RepoMetadata,
  WeeklyActivity,
} from "../core/types.js";

const GH_PROXY_BASE = "https://gh-proxy.hackclub.com/gh";

interface GitHubApiOptions {
  apiKey?: string;
}

export class GitHubClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || "";
  }

  private async fetch(path: string): Promise<Response> {
    const url = `${GH_PROXY_BASE}/${path}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`GitHub proxy error: ${res.status} ${res.statusText} for ${path}`);
    }

    return res;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await this.fetch(path);
    return res.json() as Promise<T>;
  }

  async repoExists(owner: string, repo: string): Promise<boolean> {
    try {
      await this.fetch(`repos/${owner}/${repo}`);
      return true;
    } catch {
      return false;
    }
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const data = await this.fetchJson<{ default_branch: string }>(
      `repos/${owner}/${repo}`
    );
    return data.default_branch;
  }

  async getRepoTree(owner: string, repo: string): Promise<TreeEntry[]> {
    const defaultBranch = await this.getDefaultBranch(owner, repo);

    const data = await this.fetchJson<{
      tree: Array<{
        path?: string;
        type?: string;
        size?: number;
        sha?: string;
      }>;
    }>(`repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);

    return (data.tree || []).map((entry) => ({
      path: entry.path || "",
      type: (entry.type as "blob" | "tree") || "blob",
      size: entry.size,
      sha: entry.sha || "",
    }));
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string
  ): Promise<string | null> {
    try {
      const data = await this.fetchJson<{
        content?: string;
        encoding?: string;
      }>(`repos/${owner}/${repo}/contents/${path}`);

      if (data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  async getReadme(owner: string, repo: string): Promise<string | null> {
    try {
      const data = await this.fetchJson<{
        content?: string;
        encoding?: string;
      }>(`repos/${owner}/${repo}/readme`);

      if (data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Git Forensics Methods ───────────────────────────────

  async getCommits(
    owner: string,
    repo: string,
    perPage: number = 100
  ): Promise<CommitInfo[]> {
    try {
      const data = await this.fetchJson<
        Array<{
          sha: string;
          commit: {
            message: string;
            author: { name: string; email: string; date: string };
            committer: { name: string; email: string; date: string };
          };
          author?: { login: string } | null;
        }>
      >(`repos/${owner}/${repo}/commits?per_page=${perPage}`);

      return data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        authorName: c.commit.author.name,
        authorEmail: c.commit.author.email,
        authorLogin: c.author?.login,
        date: c.commit.author.date,
        committerName: c.commit.committer.name,
        committerEmail: c.commit.committer.email,
      }));
    } catch {
      return [];
    }
  }

  async getCommitDetail(
    owner: string,
    repo: string,
    sha: string
  ): Promise<CommitDetail | null> {
    try {
      const data = await this.fetchJson<{
        sha: string;
        commit: {
          message: string;
          author: { name: string; email: string; date: string };
        };
        author?: { login: string } | null;
        stats?: { additions: number; deletions: number; total: number };
        files?: Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          changes: number;
        }>;
      }>(`repos/${owner}/${repo}/commits/${sha}`);

      return {
        sha: data.sha,
        message: data.commit.message,
        authorName: data.commit.author.name,
        authorEmail: data.commit.author.email,
        authorLogin: data.author?.login,
        date: data.commit.author.date,
        stats: data.stats || { additions: 0, deletions: 0, total: 0 },
        files: (data.files || []).map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        })),
      };
    } catch {
      return null;
    }
  }

  async getContributors(
    owner: string,
    repo: string
  ): Promise<Contributor[]> {
    try {
      const data = await this.fetchJson<
        Array<{
          login: string;
          contributions: number;
          type: string;
        }>
      >(`repos/${owner}/${repo}/contributors?per_page=100`);

      return data.map((c) => ({
        login: c.login,
        contributions: c.contributions,
        type: c.type,
      }));
    } catch {
      return [];
    }
  }

  async getRepoMetadata(
    owner: string,
    repo: string
  ): Promise<RepoMetadata> {
    const data = await this.fetchJson<{
      created_at: string;
      pushed_at: string;
      updated_at: string;
      size: number;
      stargazers_count: number;
      forks_count: number;
      open_issues_count: number;
      fork: boolean;
      parent?: { full_name: string };
      description: string | null;
      language: string | null;
      topics?: string[];
      has_wiki: boolean;
      has_pages: boolean;
      archived: boolean;
      disabled: boolean;
      visibility: string;
    }>(`repos/${owner}/${repo}`);

    return {
      createdAt: data.created_at,
      pushedAt: data.pushed_at,
      updatedAt: data.updated_at,
      size: data.size,
      stargazersCount: data.stargazers_count,
      forksCount: data.forks_count,
      openIssuesCount: data.open_issues_count,
      isFork: data.fork,
      parentFullName: data.parent?.full_name,
      description: data.description,
      language: data.language,
      topics: data.topics || [],
      hasWiki: data.has_wiki,
      hasPages: data.has_pages,
      archived: data.archived,
      disabled: data.disabled,
      visibility: data.visibility,
    };
  }

  async getCommitActivity(
    owner: string,
    repo: string
  ): Promise<WeeklyActivity[]> {
    try {
      const data = await this.fetchJson<
        Array<{
          week: number;
          total: number;
          days: number[];
        }>
      >(`repos/${owner}/${repo}/stats/commit_activity`);

      // GitHub may return 202 (accepted, computing) which our fetch handles as error
      // In that case we get an empty array, which is fine
      if (!Array.isArray(data)) return [];

      return data.map((w) => ({
        weekTimestamp: w.week,
        additions: 0, // commit_activity doesn't include add/del
        deletions: 0,
        commits: w.total,
      }));
    } catch {
      return [];
    }
  }

  async getCodeFrequency(
    owner: string,
    repo: string
  ): Promise<WeeklyActivity[]> {
    try {
      // code_frequency gives [timestamp, additions, deletions] per week
      const data = await this.fetchJson<number[][]>(
        `repos/${owner}/${repo}/stats/code_frequency`
      );

      if (!Array.isArray(data)) return [];

      return data.map((w) => ({
        weekTimestamp: w[0],
        additions: w[1] || 0,
        deletions: Math.abs(w[2] || 0),
        commits: 0,
      }));
    } catch {
      return [];
    }
  }
}
