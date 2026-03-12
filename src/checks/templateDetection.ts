import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext, TreeEntry } from "../core/types.js";

// ── Known template fingerprints ────────────────────────────

interface TemplateFingerprint {
  name: string;
  /** Files whose mere presence is a strong signal */
  signatureFiles: string[];
  /** Files to read and check content against known defaults */
  contentChecks?: Array<{
    path: string;
    /** Substrings that appear in the default template version */
    defaultPatterns: string[];
  }>;
  /** Minimum number of signature files that must match */
  minMatch?: number;
}

const TEMPLATE_FINGERPRINTS: TemplateFingerprint[] = [
  {
    name: "create-react-app",
    signatureFiles: [
      "src/App.css",
      "src/App.test.js",
      "src/reportWebVitals.js",
      "src/setupTests.js",
      "src/logo.svg",
    ],
    contentChecks: [
      {
        path: "src/App.js",
        defaultPatterns: ["Learn React", "logo.svg", "Edit <code>src/App.js</code>"],
      },
      {
        path: "src/App.tsx",
        defaultPatterns: ["Learn React", "logo.svg", "Edit <code>src/App.tsx</code>"],
      },
    ],
    minMatch: 3,
  },
  {
    name: "Next.js default",
    signatureFiles: [
      "pages/api/hello.ts",
      "pages/api/hello.js",
      "styles/Home.module.css",
      "app/page.tsx",
      "app/page.js",
    ],
    contentChecks: [
      {
        path: "pages/api/hello.ts",
        defaultPatterns: ["NextApiRequest", "John Doe"],
      },
      {
        path: "pages/api/hello.js",
        defaultPatterns: ["NextApiRequest", "John Doe"],
      },
      {
        path: "styles/Home.module.css",
        defaultPatterns: [".vercelLogo", "grid", ".card"],
      },
      {
        path: "app/page.tsx",
        defaultPatterns: ["Get started by editing", "next/image", "Vercel"],
      },
      {
        path: "app/page.js",
        defaultPatterns: ["Get started by editing", "next/image", "Vercel"],
      },
    ],
    minMatch: 1,
  },
  {
    name: "Vite + React",
    signatureFiles: [
      "src/App.tsx",
      "src/App.jsx",
      "src/App.css",
    ],
    contentChecks: [
      {
        path: "src/App.tsx",
        defaultPatterns: ["viteLogo", "reactLogo", "Vite + React", "count is"],
      },
      {
        path: "src/App.jsx",
        defaultPatterns: ["viteLogo", "reactLogo", "Vite + React", "count is"],
      },
    ],
    minMatch: 1,
  },
  {
    name: "Vue CLI",
    signatureFiles: [
      "src/components/HelloWorld.vue",
      "src/App.vue",
      "src/assets/logo.png",
    ],
    contentChecks: [
      {
        path: "src/components/HelloWorld.vue",
        defaultPatterns: ["Welcome to Your Vue.js", "Essential Links", "Ecosystem"],
      },
    ],
    minMatch: 2,
  },
  {
    name: "Angular CLI",
    signatureFiles: [
      "src/app/app.component.spec.ts",
      "src/app/app.component.ts",
      "src/app/app.component.html",
      "src/app/app.component.css",
      "angular.json",
    ],
    contentChecks: [
      {
        path: "src/app/app.component.spec.ts",
        defaultPatterns: ["should create the app", "should render title"],
      },
      {
        path: "src/app/app.component.html",
        defaultPatterns: ["Welcome", "Here are some links", "ng generate"],
      },
    ],
    minMatch: 3,
  },
  {
    name: "create-t3-app",
    signatureFiles: [
      "src/env.mjs",
      "src/server/api/routers/example.ts",
      "src/server/api/root.ts",
      "src/server/api/trpc.ts",
    ],
    contentChecks: [
      {
        path: "src/server/api/routers/example.ts",
        defaultPatterns: ["exampleRouter", "hello", "publicProcedure"],
      },
    ],
    minMatch: 3,
  },
  {
    name: "Expo default",
    signatureFiles: [
      "app/(tabs)/index.tsx",
      "app/(tabs)/explore.tsx",
      "app/(tabs)/_layout.tsx",
      "app/_layout.tsx",
    ],
    contentChecks: [
      {
        path: "app/(tabs)/index.tsx",
        defaultPatterns: ["Welcome!", "ParallaxScrollView", "Step 1"],
      },
    ],
    minMatch: 2,
  },
  {
    name: "Django default",
    signatureFiles: [
      "manage.py",
    ],
    contentChecks: [
      {
        path: "views.py",
        defaultPatterns: ["# Create your views here"],
      },
    ],
    minMatch: 1,
  },
  {
    name: "Flask Hello World",
    signatureFiles: [
      "app.py",
    ],
    contentChecks: [
      {
        path: "app.py",
        defaultPatterns: ["Hello World", "Hello, World", "@app.route(\"/\")"],
      },
    ],
    minMatch: 1,
  },
  {
    name: "Express starter",
    signatureFiles: [
      "routes/index.js",
      "routes/users.js",
      "views/index.jade",
      "views/index.ejs",
      "views/index.pug",
      "app.js",
    ],
    contentChecks: [
      {
        path: "routes/index.js",
        defaultPatterns: ["Express", "res.render('index'"],
      },
    ],
    minMatch: 2,
  },
];

// ── Boilerplate / config files that don't count as "custom" work ──

const BOILERPLATE_PATTERNS = [
  /^\./, // dotfiles
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^__pycache__\//,
  /^vendor\//,
  /^target\//,
  /^coverage\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /^tsconfig.*\.json$/,
  /^\.eslintrc/,
  /^\.prettierrc/,
  /^\.gitignore$/,
  /^LICENSE/i,
  /^readme/i,
  /^changelog/i,
  /^contributing/i,
  /^\.github\//,
  /^\.vscode\//,
  /^Dockerfile$/,
  /^docker-compose/,
  /^\.dockerignore$/,
  /^Makefile$/,
  /^Procfile$/,
  /^vercel\.json$/,
  /^netlify\.toml$/,
  /^next\.config\./,
  /^vite\.config\./,
  /^tailwind\.config\./,
  /^postcss\.config\./,
  /^jest\.config\./,
  /^babel\.config\./,
  /^webpack\.config\./,
];

function isBoilerplate(path: string): boolean {
  const filename = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
  return BOILERPLATE_PATTERNS.some((p) => p.test(path) || p.test(filename));
}

export class TemplateDetectionCheck extends BaseCheck {
  id = "template_detection";
  name = "Template Detection";
  description = "Detects if a project is a framework starter/template with minimal modifications.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const blobs = context.tree.filter((e) => e.type === "blob");

    if (blobs.length === 0) {
      return this.skip("No files in repository", config);
    }

    const evidence: string[] = [];
    const matchedTemplates: Array<{ name: string; matchCount: number; contentMatches: string[] }> = [];

    // ── Phase 1: Check file-tree against known fingerprints ──

    const blobPaths = new Set(blobs.map((e) => e.path));
    const blobPathsLower = new Set(blobs.map((e) => e.path.toLowerCase()));

    for (const template of TEMPLATE_FINGERPRINTS) {
      const sigMatches = template.signatureFiles.filter(
        (f) => blobPaths.has(f) || blobPathsLower.has(f.toLowerCase()),
      );

      const minRequired = template.minMatch ?? Math.ceil(template.signatureFiles.length * 0.6);

      if (sigMatches.length >= minRequired) {
        // Check content of key files
        const contentMatches: string[] = [];

        if (template.contentChecks) {
          for (const check of template.contentChecks) {
            const actualPath = blobs.find(
              (b) => b.path.toLowerCase() === check.path.toLowerCase(),
            )?.path;
            if (!actualPath) continue;

            try {
              const content = await context.getFile(actualPath);
              if (!content) continue;

              const matchingPatterns = check.defaultPatterns.filter((p) =>
                content.includes(p),
              );

              if (matchingPatterns.length > 0) {
                contentMatches.push(
                  `${actualPath}: matches ${matchingPatterns.length}/${check.defaultPatterns.length} default patterns`,
                );
              }
            } catch {
              // File read failed, skip
            }
          }
        }

        if (contentMatches.length > 0 || sigMatches.length >= minRequired) {
          matchedTemplates.push({
            name: template.name,
            matchCount: sigMatches.length,
            contentMatches,
          });
        }
      }
    }

    // ── Phase 2: Calculate template deviation score ──

    const customFiles = blobs.filter((e) => !isBoilerplate(e.path));
    const totalFiles = blobs.length;
    const customFileCount = customFiles.length;
    const customRatio = totalFiles > 0 ? customFileCount / totalFiles : 0;

    evidence.push(`Total files: ${totalFiles}, custom files: ${customFileCount} (${(customRatio * 100).toFixed(0)}%)`);

    // ── Phase 3: Check for very small custom file sizes ──

    const customWithSize = customFiles.filter((e) => e.size != null);
    const tinyCustomFiles = customWithSize.filter((e) => (e.size ?? 0) < 200);
    const tinyRatio = customWithSize.length > 0 ? tinyCustomFiles.length / customWithSize.length : 0;

    if (tinyRatio > 0.5 && customWithSize.length >= 3) {
      evidence.push(
        `${tinyCustomFiles.length}/${customWithSize.length} custom files are very small (<200 bytes) - minimal modification`,
      );
    }

    // ── Phase 4: Look for single-file "projects" ──

    const sourceExtensions = [
      ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".kt",
      ".c", ".cpp", ".rb", ".swift", ".cs", ".php", ".dart", ".svelte", ".vue",
      ".html",
    ];
    const sourceFiles = customFiles.filter((e) =>
      sourceExtensions.some((ext) => e.path.toLowerCase().endsWith(ext)),
    );

    if (sourceFiles.length <= 1) {
      evidence.push(`Only ${sourceFiles.length} source file(s) detected - possibly a trivial project`);
    }

    // ── Scoring ──

    let deviationScore = 100; // Start at 100 (fully custom), subtract for template signals

    // Penalty for matched templates
    for (const match of matchedTemplates) {
      const contentPenalty = match.contentMatches.length * 15;
      const sigPenalty = match.matchCount * 5;
      deviationScore -= (contentPenalty + sigPenalty);
      evidence.push(
        `Matches "${match.name}" template (${match.matchCount} signature files${match.contentMatches.length > 0 ? `, ${match.contentMatches.length} default content matches` : ""})`,
      );
      for (const cm of match.contentMatches) {
        evidence.push(`  - ${cm}`);
      }
    }

    // Penalty for low custom file ratio
    if (customRatio < 0.3) {
      deviationScore -= 20;
    } else if (customRatio < 0.5) {
      deviationScore -= 10;
    }

    // Penalty for mostly tiny files
    if (tinyRatio > 0.5 && customWithSize.length >= 3) {
      deviationScore -= 15;
    }

    // Penalty for very few source files
    if (sourceFiles.length <= 1) {
      deviationScore -= 20;
    } else if (sourceFiles.length <= 3) {
      deviationScore -= 10;
    }

    deviationScore = Math.max(0, Math.min(100, deviationScore));
    evidence.push(`Template deviation score: ${deviationScore}/100 (higher = more custom work)`);

    // ── Decision ──

    if (deviationScore <= 20) {
      return {
        checkName: this.id,
        required: config.required,
        status: config.severity === "warning" ? "warning" : "fail",
        confidence: 0.85,
        evidence,
        reason: `Project appears to be an unmodified or minimally-modified template (deviation score: ${deviationScore}/100)`,
        aiUsed: false,
      };
    }

    if (deviationScore <= 50) {
      return {
        checkName: this.id,
        required: config.required ?? false,
        status: "warning",
        confidence: 0.7,
        evidence,
        reason: `Project shows significant template content with limited custom work (deviation score: ${deviationScore}/100)`,
        aiUsed: false,
      };
    }

    return this.pass(
      `Project appears sufficiently customized beyond any template base (deviation score: ${deviationScore}/100)`,
      evidence,
      config,
    );
  }
}
