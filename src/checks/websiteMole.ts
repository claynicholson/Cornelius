import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";
import type { ClaudeClient } from "../ai/claude.js";

// ── Types ────────────────────────────────────────────────────

interface PageData {
  url: string;
  html: string;
  status: number;
  headers: Record<string, string>;
}

interface DomAnalysis {
  uniqueTags: string[];
  uniqueTagCount: number;
  formCount: number;
  buttonCount: number;
  inputCount: number;
  linkCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  uniqueCssClasses: number;
  inlineScriptCount: number;
  externalScriptCount: number;
  metaTagCount: number;
  semanticElements: string[];
  hasNav: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  hasMain: boolean;
  hasArticle: boolean;
  hasSection: boolean;
  imgCount: number;
  iframeCount: number;
  svgCount: number;
  tableCount: number;
  totalElements: number;
}

interface ContentAnalysis {
  textContentLength: number;
  hasLoremIpsum: boolean;
  hasPlaceholderText: boolean;
  defaultFrameworkTexts: string[];
  hasFavicon: boolean;
  titleText: string;
  h1Texts: string[];
  uniqueWordCount: number;
}

interface TechFingerprint {
  framework: string | null;
  componentLibrary: string | null;
  hasBundledAssets: boolean;
  hasMinifiedAssets: boolean;
  hasSourceMaps: boolean;
  detectedTechnologies: string[];
  isProductionBuild: boolean;
}

interface BackendSignals {
  hasFetchCalls: boolean;
  hasXhrCalls: boolean;
  hasWebSocket: boolean;
  apiBaseUrls: string[];
  hasAuthElements: boolean;
  hasLoginForm: boolean;
  hasEnvReferences: boolean;
  fetchCallCount: number;
}

interface MoleReport {
  pagesAnalyzed: number;
  domAnalysis: DomAnalysis;
  contentAnalysis: ContentAnalysis;
  techFingerprint: TechFingerprint;
  backendSignals: BackendSignals;
  score: number;
  maxScore: number;
  breakdown: Record<string, { score: number; max: number; details: string }>;
}

interface AiMoleVerdict {
  isGenuine: boolean;
  confidence: number;
  effortLevel: "minimal" | "low" | "moderate" | "high" | "exceptional";
  summary: string;
  concerns: string[];
  positives: string[];
}

// ── URL patterns for auto-detection (shared with urlAlive) ───

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

function extractUrlFromReadme(readme: string): string | null {
  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(readme);
    if (match) return match[0];
  }
  return null;
}

// ── HTML parsing helpers (regex-based, no deps) ──────────────

function extractAllMatches(html: string, regex: RegExp): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((match = regex.exec(html)) !== null) {
    results.push(match[1] || match[0]);
  }
  return results;
}

function countMatches(html: string, regex: RegExp): number {
  regex.lastIndex = 0;
  const matches = html.match(regex);
  return matches ? matches.length : 0;
}

function stripHtmlTags(html: string): string {
  // Remove script and style content first
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Remove all tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode basic entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const linkRegex = /href=["']([^"']+)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  let origin: string;

  try {
    const parsed = new URL(baseUrl);
    origin = parsed.origin;
  } catch {
    return [];
  }

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")
      || href.startsWith("javascript:")) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin === origin && resolved.pathname !== "/" && !links.includes(resolved.href)) {
        links.push(resolved.href);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  return links;
}

// ── Default framework text patterns ──────────────────────────

const DEFAULT_FRAMEWORK_TEXTS: { pattern: RegExp; label: string }[] = [
  { pattern: /Welcome to React/i, label: "Welcome to React" },
  { pattern: /Edit\s+<code>src\/App\.\w+<\/code>/i, label: "Edit src/App (React default)" },
  { pattern: /Learn React/i, label: "Learn React link" },
  { pattern: /save to reload/i, label: "Save to reload (CRA)" },
  { pattern: /Welcome to Next\.js/i, label: "Welcome to Next.js" },
  { pattern: /Get started by editing/i, label: "Get started by editing (Next.js default)" },
  { pattern: /Powered by.*Vercel/i, label: "Powered by Vercel default" },
  { pattern: /Welcome to Nuxt/i, label: "Welcome to Nuxt" },
  { pattern: /Hello world/i, label: "Hello world placeholder" },
  { pattern: /Welcome to.*Angular/i, label: "Angular default page" },
  { pattern: /app is running!/i, label: "App is running (Angular)" },
  { pattern: /Welcome to SvelteKit/i, label: "SvelteKit default" },
  { pattern: /Vite \+ React/i, label: "Vite + React default" },
  { pattern: /Vite \+ Vue/i, label: "Vite + Vue default" },
  { pattern: /Vite \+ Svelte/i, label: "Vite + Svelte default" },
  { pattern: /count is \d+/i, label: "Vite counter default" },
  { pattern: /Click on the Vite/i, label: "Vite default page" },
  { pattern: /This page intentionally left blank/i, label: "Intentionally blank page" },
  { pattern: /Congratulations.*app.*created/i, label: "Default congratulations page" },
  { pattern: /Documentation.*Learn.*Deploy/i, label: "Next.js default card layout" },
];

// ── Technology detection patterns ────────────────────────────

const FRAMEWORK_SIGNATURES: { pattern: RegExp; name: string }[] = [
  { pattern: /__next/i, name: "Next.js" },
  { pattern: /__nuxt/i, name: "Nuxt" },
  { pattern: /_next\/static/i, name: "Next.js" },
  { pattern: /\/_nuxt\//i, name: "Nuxt" },
  { pattern: /data-reactroot/i, name: "React" },
  { pattern: /data-react-helmet/i, name: "React" },
  { pattern: /__NEXT_DATA__/i, name: "Next.js" },
  { pattern: /window\.__NUXT__/i, name: "Nuxt" },
  { pattern: /ng-version/i, name: "Angular" },
  { pattern: /ng-app/i, name: "Angular" },
  { pattern: /data-v-[a-f0-9]/i, name: "Vue" },
  { pattern: /id="__svelte"/i, name: "Svelte" },
  { pattern: /svelte-[\w]+/i, name: "Svelte" },
  { pattern: /data-sveltekit/i, name: "SvelteKit" },
  { pattern: /gatsby-/i, name: "Gatsby" },
  { pattern: /remix-/i, name: "Remix" },
  { pattern: /data-astro/i, name: "Astro" },
];

const COMPONENT_LIBRARY_SIGNATURES: { pattern: RegExp; name: string }[] = [
  { pattern: /mui-|MuiButton|css-[\w]+-Mui/i, name: "Material UI" },
  { pattern: /chakra-ui/i, name: "Chakra UI" },
  { pattern: /ant-btn|ant-layout|antd/i, name: "Ant Design" },
  { pattern: /tailwind/i, name: "Tailwind CSS" },
  { pattern: /tw-[\w]/i, name: "Tailwind CSS" },
  { pattern: /bootstrap|btn-primary|container-fluid/i, name: "Bootstrap" },
  { pattern: /shadcn/i, name: "shadcn/ui" },
  { pattern: /radix-/i, name: "Radix UI" },
  { pattern: /mantine-/i, name: "Mantine" },
  { pattern: /flowbite/i, name: "Flowbite" },
  { pattern: /bulma/i, name: "Bulma" },
  { pattern: /foundation/i, name: "Foundation" },
  { pattern: /semantic-ui|ui\.semantic/i, name: "Semantic UI" },
];

// ── Fetch helper with timeout ────────────────────────────────

async function fetchPage(url: string, timeoutMs: number = 10_000): Promise<PageData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Cornelius/1.0 (Hack Club YSWS Review Bot)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const html = await response.text();

    return {
      url,
      html,
      status: response.status,
      headers,
    };
  } catch {
    return null;
  }
}

// ── Analysis functions ───────────────────────────────────────

function analyzeDom(pages: PageData[]): DomAnalysis {
  const allHtml = pages.map((p) => p.html).join("\n");

  // Extract all HTML tags used
  const tagRegex = /<(\w+)[\s>\/]/g;
  const tagSet = new Set<string>();
  let tagMatch: RegExpExecArray | null;
  let totalElements = 0;
  while ((tagMatch = tagRegex.exec(allHtml)) !== null) {
    tagSet.add(tagMatch[1].toLowerCase());
    totalElements++;
  }

  // Extract CSS classes
  const classRegex = /class=["']([^"']+)["']/gi;
  const classSet = new Set<string>();
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(allHtml)) !== null) {
    const classes = classMatch[1].split(/\s+/);
    for (const c of classes) {
      if (c.trim()) classSet.add(c.trim());
    }
  }

  // Count interactive elements
  const formCount = countMatches(allHtml, /<form[\s>]/gi);
  const buttonCount = countMatches(allHtml, /<button[\s>]/gi)
    + countMatches(allHtml, /type=["']submit["']/gi)
    + countMatches(allHtml, /role=["']button["']/gi);
  const inputCount = countMatches(allHtml, /<input[\s>]/gi)
    + countMatches(allHtml, /<textarea[\s>]/gi)
    + countMatches(allHtml, /<select[\s>]/gi);

  // Count links
  const allLinks = extractAllMatches(allHtml, /href=["']([^"']+)["']/gi);
  const linkCount = allLinks.length;

  // Internal vs external (approximate)
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  for (const href of allLinks) {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      externalLinkCount++;
    } else if (href.startsWith("/") || href.startsWith("./") || !href.includes("://")) {
      internalLinkCount++;
    }
  }

  // Scripts
  const inlineScriptCount = countMatches(allHtml, /<script(?![^>]*\bsrc\b)[^>]*>/gi);
  const externalScriptCount = countMatches(allHtml, /<script[^>]+src=/gi);

  // Meta tags
  const metaTagCount = countMatches(allHtml, /<meta[\s]/gi);

  // Semantic elements
  const semanticTags = ["header", "nav", "main", "footer", "article", "section", "aside", "figure", "figcaption", "details", "summary", "dialog", "mark", "time"];
  const foundSemantic = semanticTags.filter((tag) =>
    new RegExp(`<${tag}[\\s>]`, "i").test(allHtml)
  );

  return {
    uniqueTags: [...tagSet],
    uniqueTagCount: tagSet.size,
    formCount,
    buttonCount,
    inputCount,
    linkCount,
    internalLinkCount,
    externalLinkCount,
    uniqueCssClasses: classSet.size,
    inlineScriptCount,
    externalScriptCount,
    metaTagCount,
    semanticElements: foundSemantic,
    hasNav: foundSemantic.includes("nav"),
    hasHeader: foundSemantic.includes("header"),
    hasFooter: foundSemantic.includes("footer"),
    hasMain: foundSemantic.includes("main"),
    hasArticle: foundSemantic.includes("article"),
    hasSection: foundSemantic.includes("section"),
    imgCount: countMatches(allHtml, /<img[\s]/gi),
    iframeCount: countMatches(allHtml, /<iframe[\s]/gi),
    svgCount: countMatches(allHtml, /<svg[\s>]/gi),
    tableCount: countMatches(allHtml, /<table[\s>]/gi),
    totalElements,
  };
}

function analyzeContent(pages: PageData[]): ContentAnalysis {
  const allHtml = pages.map((p) => p.html).join("\n");
  const plainText = stripHtmlTags(allHtml);

  // Lorem ipsum
  const hasLoremIpsum = /lorem\s+ipsum/i.test(allHtml);

  // Placeholder text patterns
  const hasPlaceholderText = /\b(placeholder|sample\s+text|your\s+(content|text)\s+here|coming\s+soon|under\s+construction|work\s+in\s+progress)\b/i.test(plainText);

  // Check for default framework texts
  const defaultFrameworkTexts: string[] = [];
  for (const { pattern, label } of DEFAULT_FRAMEWORK_TEXTS) {
    pattern.lastIndex = 0;
    if (pattern.test(allHtml)) {
      defaultFrameworkTexts.push(label);
    }
  }

  // Favicon
  const hasFavicon = /rel=["'](?:shortcut\s+)?icon["']/i.test(allHtml)
    || /rel=["']apple-touch-icon["']/i.test(allHtml)
    || /<link[^>]+favicon/i.test(allHtml);

  // Title
  const titleMatch = allHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : "";

  // H1s
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  const h1Texts = extractAllMatches(allHtml, h1Regex).map((t) =>
    t.replace(/<[^>]+>/g, "").trim()
  );

  // Unique words
  const words = plainText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const uniqueWords = new Set(words);

  return {
    textContentLength: plainText.length,
    hasLoremIpsum,
    hasPlaceholderText,
    defaultFrameworkTexts,
    hasFavicon,
    titleText,
    h1Texts,
    uniqueWordCount: uniqueWords.size,
  };
}

function fingerPrintTech(pages: PageData[]): TechFingerprint {
  const allHtml = pages.map((p) => p.html).join("\n");
  const detectedTechnologies: string[] = [];

  // Framework detection
  let framework: string | null = null;
  for (const { pattern, name } of FRAMEWORK_SIGNATURES) {
    pattern.lastIndex = 0;
    if (pattern.test(allHtml)) {
      if (!framework) framework = name;
      if (!detectedTechnologies.includes(name)) detectedTechnologies.push(name);
    }
  }

  // Component library detection
  let componentLibrary: string | null = null;
  for (const { pattern, name } of COMPONENT_LIBRARY_SIGNATURES) {
    pattern.lastIndex = 0;
    if (pattern.test(allHtml)) {
      if (!componentLibrary) componentLibrary = name;
      if (!detectedTechnologies.includes(name)) detectedTechnologies.push(name);
    }
  }

  // Bundled/minified assets
  const hasBundledAssets = /[\w]+\.[a-f0-9]{8,}\.(?:js|css)/i.test(allHtml)
    || /chunk[-.]\w+\.js/i.test(allHtml)
    || /bundle\.(?:min\.)?js/i.test(allHtml);

  const hasMinifiedAssets = /\.min\.(js|css)/i.test(allHtml) || hasBundledAssets;

  // Source maps
  const hasSourceMaps = /sourceMappingURL/i.test(allHtml) || /\.map["']/i.test(allHtml);

  // Additional tech detection
  if (/type=["']module["']/i.test(allHtml)) detectedTechnologies.push("ES Modules");
  if (/service-?worker/i.test(allHtml)) detectedTechnologies.push("Service Worker");
  if (/<canvas[\s>]/i.test(allHtml)) detectedTechnologies.push("Canvas");
  if (/webgl/i.test(allHtml)) detectedTechnologies.push("WebGL");
  if (/three\.js|THREE\./i.test(allHtml)) detectedTechnologies.push("Three.js");
  if (/socket\.io/i.test(allHtml)) detectedTechnologies.push("Socket.io");
  if (/firebase/i.test(allHtml)) detectedTechnologies.push("Firebase");
  if (/supabase/i.test(allHtml)) detectedTechnologies.push("Supabase");
  if (/clerk/i.test(allHtml)) detectedTechnologies.push("Clerk");
  if (/stripe/i.test(allHtml)) detectedTechnologies.push("Stripe");
  if (/google.*analytics|gtag|UA-\d/i.test(allHtml)) detectedTechnologies.push("Google Analytics");
  if (/hotjar/i.test(allHtml)) detectedTechnologies.push("Hotjar");
  if (/sentry/i.test(allHtml)) detectedTechnologies.push("Sentry");

  // Production build heuristic
  const isProductionBuild = hasBundledAssets && !hasSourceMaps;

  // Check response headers for tech signals
  for (const page of pages) {
    const server = page.headers["server"] || page.headers["x-powered-by"] || "";
    if (server && !detectedTechnologies.includes(server)) {
      detectedTechnologies.push(`Server: ${server}`);
    }
  }

  return {
    framework,
    componentLibrary,
    hasBundledAssets,
    hasMinifiedAssets,
    hasSourceMaps,
    detectedTechnologies: [...new Set(detectedTechnologies)],
    isProductionBuild,
  };
}

function detectBackendSignals(pages: PageData[]): BackendSignals {
  const allHtml = pages.map((p) => p.html).join("\n");

  // Extract script content for deeper analysis
  const scriptContentRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  const scriptContents: string[] = [];
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptContentRegex.exec(allHtml)) !== null) {
    if (scriptMatch[1].trim()) {
      scriptContents.push(scriptMatch[1]);
    }
  }
  const scriptText = scriptContents.join("\n");
  const combinedText = allHtml + "\n" + scriptText;

  // Fetch/XHR calls
  const fetchCallCount = countMatches(combinedText, /\bfetch\s*\(/gi)
    + countMatches(combinedText, /axios\.\w+/gi)
    + countMatches(combinedText, /\$\.(?:ajax|get|post)/gi);
  const hasFetchCalls = fetchCallCount > 0;
  const hasXhrCalls = /XMLHttpRequest/i.test(combinedText) || /\.open\s*\(\s*["'](?:GET|POST|PUT|DELETE|PATCH)/i.test(combinedText);

  // WebSocket
  const hasWebSocket = /new\s+WebSocket/i.test(combinedText) || /socket\.io/i.test(combinedText)
    || /wss?:\/\//i.test(combinedText);

  // API base URLs
  const apiUrlRegex = /["']((?:https?:\/\/[^"']+)?\/api\/[^"']*|https?:\/\/[^"']*(?:api|graphql|rest)[^"']*)["']/gi;
  const apiUrls: string[] = [];
  let apiMatch: RegExpExecArray | null;
  while ((apiMatch = apiUrlRegex.exec(combinedText)) !== null) {
    const url = apiMatch[1];
    if (!apiUrls.includes(url) && apiUrls.length < 10) {
      apiUrls.push(url);
    }
  }

  // Auth elements
  const hasLoginForm = /type=["']password["']/i.test(allHtml)
    || /login|sign.?in|log.?in/i.test(allHtml);
  const hasAuthElements = hasLoginForm
    || /auth|token|jwt|bearer|oauth|session/i.test(combinedText)
    || /Authorization/i.test(combinedText);

  // Env references
  const hasEnvReferences = /process\.env/i.test(combinedText)
    || /NEXT_PUBLIC_/i.test(combinedText)
    || /VITE_/i.test(combinedText)
    || /REACT_APP_/i.test(combinedText);

  return {
    hasFetchCalls,
    hasXhrCalls,
    hasWebSocket,
    apiBaseUrls: apiUrls,
    hasAuthElements,
    hasLoginForm,
    hasEnvReferences,
    fetchCallCount,
  };
}

// ── Scoring engine ───────────────────────────────────────────

function calculateScore(
  pages: PageData[],
  dom: DomAnalysis,
  content: ContentAnalysis,
  tech: TechFingerprint,
  backend: BackendSignals,
): { score: number; maxScore: number; breakdown: Record<string, { score: number; max: number; details: string }> } {
  const breakdown: Record<string, { score: number; max: number; details: string }> = {};

  // 1. Multi-page presence (max 15)
  {
    const pageScore = Math.min(pages.length * 3, 15);
    breakdown["multi_page"] = {
      score: pageScore,
      max: 15,
      details: `${pages.length} page(s) successfully crawled`,
    };
  }

  // 2. DOM complexity (max 20)
  {
    let score = 0;
    const details: string[] = [];

    if (dom.uniqueTagCount >= 20) { score += 5; details.push(`${dom.uniqueTagCount} unique tags`); }
    else if (dom.uniqueTagCount >= 10) { score += 3; details.push(`${dom.uniqueTagCount} unique tags`); }
    else { details.push(`Only ${dom.uniqueTagCount} unique tags`); }

    if (dom.uniqueCssClasses >= 50) { score += 5; details.push(`${dom.uniqueCssClasses} unique CSS classes`); }
    else if (dom.uniqueCssClasses >= 20) { score += 3; details.push(`${dom.uniqueCssClasses} CSS classes`); }
    else { details.push(`Only ${dom.uniqueCssClasses} CSS classes`); }

    if (dom.formCount > 0 || dom.buttonCount > 0 || dom.inputCount > 0) {
      score += 4;
      details.push(`Interactive: ${dom.formCount} forms, ${dom.buttonCount} buttons, ${dom.inputCount} inputs`);
    }

    const semanticCount = dom.semanticElements.length;
    if (semanticCount >= 4) { score += 3; details.push(`${semanticCount} semantic elements`); }
    else if (semanticCount >= 2) { score += 2; details.push(`${semanticCount} semantic elements`); }

    if (dom.imgCount > 0 || dom.svgCount > 0) {
      score += 3;
      details.push(`${dom.imgCount} images, ${dom.svgCount} SVGs`);
    }

    breakdown["dom_complexity"] = { score: Math.min(score, 20), max: 20, details: details.join("; ") };
  }

  // 3. Content authenticity (max 25)
  {
    let score = 0;
    const details: string[] = [];

    // Positive: real text content
    if (content.uniqueWordCount >= 200) { score += 6; details.push(`Rich content: ${content.uniqueWordCount} unique words`); }
    else if (content.uniqueWordCount >= 50) { score += 4; details.push(`${content.uniqueWordCount} unique words`); }
    else if (content.uniqueWordCount >= 20) { score += 2; details.push(`Sparse: ${content.uniqueWordCount} unique words`); }
    else { details.push(`Very little content: ${content.uniqueWordCount} unique words`); }

    // Positive: custom title
    if (content.titleText && content.titleText.length > 0
      && !/^(React App|Next\.js|Nuxt|Create React App|Vite App|Document|Index)$/i.test(content.titleText)) {
      score += 4;
      details.push(`Custom title: "${content.titleText}"`);
    }

    // Positive: has favicon
    if (content.hasFavicon) {
      score += 3;
      details.push("Has custom favicon");
    }

    // Positive: has H1 headings
    if (content.h1Texts.length > 0) {
      score += 2;
      details.push(`${content.h1Texts.length} H1 heading(s)`);
    }

    // Negative: lorem ipsum
    if (content.hasLoremIpsum) {
      score -= 5;
      details.push("PENALTY: Contains lorem ipsum");
    }

    // Negative: placeholder text
    if (content.hasPlaceholderText) {
      score -= 3;
      details.push("PENALTY: Contains placeholder text");
    }

    // Negative: default framework text
    if (content.defaultFrameworkTexts.length > 0) {
      const penalty = Math.min(content.defaultFrameworkTexts.length * 4, 10);
      score -= penalty;
      details.push(`PENALTY: Default framework text detected: ${content.defaultFrameworkTexts.join(", ")}`);
    }

    breakdown["content_authenticity"] = { score: Math.max(score, 0), max: 25, details: details.join("; ") };
  }

  // 4. Technology & build quality (max 20)
  {
    let score = 0;
    const details: string[] = [];

    if (tech.framework) {
      score += 4;
      details.push(`Framework: ${tech.framework}`);
    }

    if (tech.componentLibrary) {
      score += 3;
      details.push(`UI library: ${tech.componentLibrary}`);
    }

    if (tech.isProductionBuild) {
      score += 5;
      details.push("Production build (bundled, no source maps)");
    } else if (tech.hasBundledAssets) {
      score += 3;
      details.push("Has bundled assets");
    }

    if (tech.hasMinifiedAssets) {
      score += 3;
      details.push("Minified assets");
    }

    if (tech.detectedTechnologies.length > 3) {
      score += 5;
      details.push(`${tech.detectedTechnologies.length} technologies detected`);
    } else if (tech.detectedTechnologies.length > 1) {
      score += 3;
      details.push(`${tech.detectedTechnologies.length} technologies detected`);
    }

    breakdown["technology"] = { score: Math.min(score, 20), max: 20, details: details.join("; ") };
  }

  // 5. Backend / API signals (max 20)
  {
    let score = 0;
    const details: string[] = [];

    if (backend.hasFetchCalls || backend.hasXhrCalls) {
      score += 6;
      details.push(`API calls detected (${backend.fetchCallCount} fetch-like calls)`);
    }

    if (backend.apiBaseUrls.length > 0) {
      score += 4;
      details.push(`${backend.apiBaseUrls.length} API endpoint(s) found`);
    }

    if (backend.hasWebSocket) {
      score += 4;
      details.push("WebSocket detected");
    }

    if (backend.hasAuthElements) {
      score += 3;
      details.push("Auth-related elements found");
    }

    if (backend.hasEnvReferences) {
      score += 3;
      details.push("Environment variable references found");
    }

    breakdown["backend_signals"] = { score: Math.min(score, 20), max: 20, details: details.join("; ") || "No backend signals detected" };
  }

  // Tally
  let totalScore = 0;
  let totalMax = 0;
  for (const section of Object.values(breakdown)) {
    totalScore += section.score;
    totalMax += section.max;
  }

  return { score: totalScore, maxScore: totalMax, breakdown };
}

// ── The check ────────────────────────────────────────────────

export class WebsiteMoleCheck extends BaseCheck {
  id = "website_mole";
  name = "Website Mole (Deep Inspection)";
  description = "Deep multi-page website inspection analyzing DOM complexity, content authenticity, technology stack, and backend signals to verify genuine work.";

  private claude?: ClaudeClient;

  constructor(claude?: ClaudeClient) {
    super();
    this.claude = claude;
  }

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    // ── Resolve URL ──────────────────────────────────────────
    let url = config.url as string | undefined;
    if (!url && context.readme) {
      url = extractUrlFromReadme(context.readme) ?? undefined;
    }
    if (!url) {
      return this.skip("No playable URL provided and none detected in README", config);
    }

    // Normalize URL
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    // ── Phase 1: Fetch homepage ──────────────────────────────
    const homepage = await fetchPage(url, 10_000);
    if (!homepage) {
      return this.fail(`Failed to fetch website at ${url} (timeout or network error)`, [url], config);
    }
    if (homepage.status !== 200) {
      return this.fail(`Website returned HTTP ${homepage.status}`, [url], config);
    }
    if (!homepage.html || homepage.html.trim().length < 50) {
      return this.fail("Website returned empty or near-empty response", [url], config);
    }

    // ── Phase 2: Multi-page crawl (up to 5 pages total) ─────
    const pages: PageData[] = [homepage];
    const crawlDeadline = Date.now() + 30_000; // 30s total budget

    const internalLinks = extractInternalLinks(homepage.html, url);
    // Shuffle and pick up to 4 additional pages
    const linksToCrawl = internalLinks
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);

    // Crawl in parallel with remaining time budget
    if (linksToCrawl.length > 0 && Date.now() < crawlDeadline) {
      const remainingMs = crawlDeadline - Date.now();
      const perPageTimeout = Math.min(remainingMs / linksToCrawl.length, 8_000);

      const crawlResults = await Promise.allSettled(
        linksToCrawl.map((link) => fetchPage(link, perPageTimeout))
      );

      for (const result of crawlResults) {
        if (result.status === "fulfilled" && result.value && result.value.status === 200) {
          pages.push(result.value);
        }
      }
    }

    // ── Phase 3: Run all analyses ────────────────────────────
    const dom = analyzeDom(pages);
    const content = analyzeContent(pages);
    const tech = fingerPrintTech(pages);
    const backend = detectBackendSignals(pages);
    const { score, maxScore, breakdown } = calculateScore(pages, dom, content, tech, backend);

    const report: MoleReport = {
      pagesAnalyzed: pages.length,
      domAnalysis: dom,
      contentAnalysis: content,
      techFingerprint: tech,
      backendSignals: backend,
      score,
      maxScore,
      breakdown,
    };

    // ── Phase 4: Compile evidence ────────────────────────────
    const evidence: string[] = [
      `URL: ${url}`,
      `Pages crawled: ${pages.length}/${linksToCrawl.length + 1}`,
      `Heuristic score: ${score}/${maxScore} (${Math.round((score / maxScore) * 100)}%)`,
    ];

    for (const [key, section] of Object.entries(breakdown)) {
      evidence.push(`[${key}] ${section.score}/${section.max}: ${section.details}`);
    }

    if (tech.framework) evidence.push(`Framework: ${tech.framework}`);
    if (tech.componentLibrary) evidence.push(`UI library: ${tech.componentLibrary}`);
    if (tech.detectedTechnologies.length > 0) {
      evidence.push(`Technologies: ${tech.detectedTechnologies.join(", ")}`);
    }
    if (content.defaultFrameworkTexts.length > 0) {
      evidence.push(`Default framework text: ${content.defaultFrameworkTexts.join(", ")}`);
    }
    if (content.hasLoremIpsum) evidence.push("Contains lorem ipsum placeholder text");
    if (backend.apiBaseUrls.length > 0) {
      evidence.push(`API endpoints: ${backend.apiBaseUrls.slice(0, 5).join(", ")}`);
    }

    // ── Phase 5: AI holistic analysis (if available) ─────────
    if (this.claude) {
      try {
        const reportSummary = JSON.stringify({
          url,
          pagesAnalyzed: report.pagesAnalyzed,
          score: `${score}/${maxScore}`,
          breakdown: Object.fromEntries(
            Object.entries(breakdown).map(([k, v]) => [k, `${v.score}/${v.max}: ${v.details}`])
          ),
          titleText: content.titleText,
          h1Texts: content.h1Texts,
          uniqueWordCount: content.uniqueWordCount,
          hasLoremIpsum: content.hasLoremIpsum,
          defaultFrameworkTexts: content.defaultFrameworkTexts,
          framework: tech.framework,
          componentLibrary: tech.componentLibrary,
          technologies: tech.detectedTechnologies,
          isProductionBuild: tech.isProductionBuild,
          hasApiCalls: backend.hasFetchCalls,
          hasAuth: backend.hasAuthElements,
          apiEndpoints: backend.apiBaseUrls.slice(0, 5),
          domStats: {
            uniqueTags: dom.uniqueTagCount,
            cssClasses: dom.uniqueCssClasses,
            forms: dom.formCount,
            buttons: dom.buttonCount,
            inputs: dom.inputCount,
            images: dom.imgCount,
            semanticElements: dom.semanticElements,
          },
        }, null, 2);

        // Truncate homepage HTML for AI context
        const truncatedHtml = homepage.html.length > 4000
          ? homepage.html.slice(0, 4000) + "\n... (truncated)"
          : homepage.html;

        const prompt = (config.prompt as string) ||
          `You are a website authenticity reviewer for a Hack Club YSWS (You Ship We Ship) grant program. Students submit projects and we need to verify genuine effort.

Analyze this deep website inspection report and a sample of the homepage HTML. Determine if this represents genuine student work or a low-effort/template/placeholder submission.

Consider:
- Does the heuristic score match what you see in the HTML?
- Is this a real application with custom content, or a barely-modified template?
- How much effort does this represent?
- Are there signs of genuine development (custom components, real data, working features)?
- Are there red flags (default text, placeholder content, minimal customization)?

Return JSON:
{
  "isGenuine": boolean,
  "confidence": number (0-1),
  "effortLevel": "minimal" | "low" | "moderate" | "high" | "exceptional",
  "summary": "2-3 sentence summary of findings",
  "concerns": ["list of concerns, if any"],
  "positives": ["list of positive signals"]
}`;

        const aiContent = `## Inspection Report\n\n${reportSummary}\n\n## Homepage HTML Sample\n\n${truncatedHtml}`;
        const verdict = await this.claude.askStructured<AiMoleVerdict>(prompt, aiContent, 1024);

        // Merge AI verdict into evidence
        evidence.push(`AI verdict: ${verdict.isGenuine ? "GENUINE" : "NOT GENUINE"} (${verdict.effortLevel} effort, ${Math.round(verdict.confidence * 100)}% confidence)`);
        evidence.push(`AI summary: ${verdict.summary}`);
        if (verdict.concerns.length > 0) {
          evidence.push(`AI concerns: ${verdict.concerns.join("; ")}`);
        }
        if (verdict.positives.length > 0) {
          evidence.push(`AI positives: ${verdict.positives.join("; ")}`);
        }

        // AI-adjusted decision
        const scorePercent = score / maxScore;

        if (!verdict.isGenuine && verdict.confidence >= 0.7) {
          return {
            checkName: this.id,
            required: config.required,
            status: config.severity === "warning" ? "warning" : "fail",
            confidence: verdict.confidence,
            evidence,
            reason: `Website does not appear to be genuine work. ${verdict.summary}`,
            aiUsed: true,
          };
        }

        if (verdict.effortLevel === "minimal" || verdict.effortLevel === "low") {
          return {
            checkName: this.id,
            required: config.required,
            status: "warning",
            confidence: verdict.confidence,
            evidence,
            reason: `Website shows ${verdict.effortLevel} effort. ${verdict.summary}`,
            aiUsed: true,
          };
        }

        if (verdict.isGenuine && scorePercent >= 0.3) {
          return {
            checkName: this.id,
            required: config.required,
            status: "pass",
            confidence: verdict.confidence,
            evidence,
            reason: `Website appears genuine with ${verdict.effortLevel} effort (${score}/${maxScore} heuristic). ${verdict.summary}`,
            aiUsed: true,
          };
        }

        // Mixed signals
        return {
          checkName: this.id,
          required: config.required,
          status: "warning",
          confidence: verdict.confidence * 0.8,
          evidence,
          reason: `Mixed signals: heuristic score ${score}/${maxScore}, AI says ${verdict.effortLevel} effort. ${verdict.summary}`,
          aiUsed: true,
        };
      } catch {
        // AI failed, fall through to heuristic-only decision
      }
    }

    // ── Phase 6: Heuristic-only decision ─────────────────────
    const percent = score / maxScore;

    if (content.defaultFrameworkTexts.length >= 2) {
      return this.fail(
        `Website appears to be an unmodified framework template (score ${score}/${maxScore}). Default text found: ${content.defaultFrameworkTexts.join(", ")}`,
        evidence,
        config,
      );
    }

    if (percent >= 0.5) {
      return {
        ...this.pass(
          `Website shows genuine work (score ${score}/${maxScore}, ${Math.round(percent * 100)}%)`,
          evidence,
          config,
        ),
        confidence: Math.min(0.6 + percent * 0.3, 0.9),
      };
    }

    if (percent >= 0.3) {
      return {
        ...this.warn(
          `Website shows limited evidence of genuine work (score ${score}/${maxScore}, ${Math.round(percent * 100)}%)`,
          evidence,
          config,
        ),
        confidence: 0.6,
      };
    }

    return {
      ...this.fail(
        `Website shows insufficient evidence of genuine work (score ${score}/${maxScore}, ${Math.round(percent * 100)}%)`,
        evidence,
        config,
      ),
      confidence: 0.7,
    };
  }
}
