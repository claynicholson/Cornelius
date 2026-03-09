const GITHUB_URL_PATTERNS = [
  /^https?:\/\/github\.com\/([^\/]+)\/([^\/\s#?]+)\/?.*$/,
  /^github\.com\/([^\/]+)\/([^\/\s#?]+)\/?.*$/,
];

export interface ParsedRepo {
  owner: string;
  repo: string;
  url: string;
}

export function parseGitHubUrl(url: string): ParsedRepo | null {
  const trimmed = url.trim().replace(/\.git$/, "");

  for (const pattern of GITHUB_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
        url: `https://github.com/${match[1]}/${match[2]}`,
      };
    }
  }

  return null;
}

export function isValidGitHubUrl(url: string): boolean {
  return parseGitHubUrl(url) !== null;
}
