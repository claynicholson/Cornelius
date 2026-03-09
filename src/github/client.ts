import type { TreeEntry } from "../core/types.js";

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
}
