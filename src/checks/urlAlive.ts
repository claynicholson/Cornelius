import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

/** Common deployment platform patterns to auto-detect from README */
const URL_PATTERNS = [
  /https?:\/\/[\w-]+\.vercel\.app\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.netlify\.app\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.github\.io\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.railway\.app\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.fly\.dev\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.render\.com\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.surge\.sh\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.pages\.dev\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.web\.app\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.firebaseapp\.com\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.herokuapp\.com\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.replit\.app\b[^\s)"]*/gi,
  /https?:\/\/[\w-]+\.glitch\.me\b[^\s)"]*/gi,
];

/** Try to find a deployed URL in README content */
function extractUrlFromReadme(readme: string): string | null {
  for (const pattern of URL_PATTERNS) {
    // Reset lastIndex since we use 'g' flag
    pattern.lastIndex = 0;
    const match = pattern.exec(readme);
    if (match) {
      return match[0];
    }
  }
  return null;
}

interface UrlAnalysis {
  isReal: boolean;
  confidence: number;
  reason: string;
}

export class UrlAliveCheck extends BaseCheck {
  id = "url_alive";
  name = "Playable URL Alive";
  description = "Checks that the deployed website URL is accessible and serves a real application.";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    // Get URL from config (explicit) or auto-detect from README
    let url = config.url as string | undefined;

    if (!url && context.readme) {
      url = extractUrlFromReadme(context.readme) ?? undefined;
    }

    if (!url) {
      return this.fail(
        "No playable URL provided and none detected in README",
        [],
        config
      );
    }

    // Fetch the URL
    let html: string;
    let statusCode: number;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Cornelius/1.0 (Hack Club YSWS Review Bot)",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        redirect: "follow",
      });

      clearTimeout(timeout);
      statusCode = response.status;
      html = await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) {
        return this.fail(`URL timed out after 10 seconds: ${url}`, [url], config);
      }
      return this.fail(`Failed to fetch URL: ${message}`, [url], config);
    }

    if (statusCode !== 200) {
      return this.fail(
        `URL returned HTTP ${statusCode}`,
        [url],
        config
      );
    }

    if (!html || html.trim().length < 100) {
      return this.fail(
        "URL returned empty or near-empty response",
        [url],
        config
      );
    }

    // AI analysis if available
    if (this.claude) {
      try {
        const prompt = (config.prompt as string) ||
          `Analyze this HTML content from a deployed website at ${url}. Determine if this is a real, functional web application or something else (parked domain, default template page, error page, empty shell, placeholder).

Look for:
- Real application content (navigation, interactive elements, meaningful text)
- Signs of a working app (forms, dynamic content areas, API references)
- Red flags: default "Welcome to React/Next.js" pages, 404 errors, domain parking pages, blank pages with only boilerplate

Return JSON: {"isReal": boolean, "confidence": number 0-1, "reason": "brief explanation of what the site appears to be"}`;

        const truncatedHtml = html.length > 5000 ? html.slice(0, 5000) + "\n... (truncated)" : html;
        const analysis = await this.claude.askStructured<UrlAnalysis>(prompt, truncatedHtml);

        if (!analysis.isReal) {
          return {
            checkName: this.id,
            required: config.required,
            status: config.severity === "warning" ? "warning" : "fail",
            confidence: analysis.confidence,
            evidence: [url],
            reason: analysis.reason,
            aiUsed: true,
          };
        }

        return {
          checkName: this.id,
          required: config.required,
          status: "pass",
          confidence: analysis.confidence,
          evidence: [url],
          reason: analysis.reason,
          aiUsed: true,
        };
      } catch {
        // Fall through to basic pass
      }
    }

    // Basic pass: URL is up and returns HTML
    return this.pass(
      `URL is accessible and returns HTML (${html.length} chars)`,
      [url],
      config
    );
  }
}
