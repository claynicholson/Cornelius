import "dotenv/config";
import express from "express";
import session from "express-session";
import multer from "multer";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { reviewRepository } from "./core/reviewer.js";
import { readCsv } from "./batch/csvReader.js";
import { processBatch } from "./batch/processor.js";
import { isValidGitHubUrl } from "./github/parser.js";
import { writeFileSync, unlinkSync, existsSync, readdirSync } from "fs";
import type { UserSession, PresetConfig } from "./core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: "uploads/" });

// ── Session setup ─────────────────────────────────────────
declare module "express-session" {
  interface SessionData {
    user?: UserSession;
  }
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || uuidv4(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

app.use(express.json());
app.use(express.static(resolve(__dirname, "web/public")));

// ── In-memory user store (for persistence across sessions) ──
const userStore = new Map<string, UserSession>();

// ── Hack Club OAuth ───────────────────────────────────────
const HC_CLIENT_ID = process.env.HC_CLIENT_ID;
const HC_CLIENT_SECRET = process.env.HC_CLIENT_SECRET;
const HC_AUTH_URL =
  process.env.HC_AUTH_URL || "https://auth.hackclub.com/oauth/authorize";
const HC_TOKEN_URL =
  process.env.HC_TOKEN_URL || "https://auth.hackclub.com/oauth/token";
const HC_USER_URL =
  process.env.HC_USER_URL || "https://auth.hackclub.com/api/v1/me";

app.get("/auth/login", (req, res) => {
  if (!HC_CLIENT_ID) {
    res.status(500).json({ error: "HC_CLIENT_ID not configured" });
    return;
  }
  const redirectUri = `${req.protocol}://${req.get("host")}/oauth/callback`;
  const params = new URLSearchParams({
    client_id: HC_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "email name",
  });
  res.redirect(`${HC_AUTH_URL}?${params}`);
});

app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code || !HC_CLIENT_ID || !HC_CLIENT_SECRET) {
    res.redirect("/?error=auth_failed");
    return;
  }

  try {
    // Exchange authorization code for access token
    const redirectUri = `${req.protocol}://${req.get("host")}/oauth/callback`;
    const tokenRes = await fetch(HC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: HC_CLIENT_ID,
        client_secret: HC_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      res.redirect("/?error=token_exchange_failed");
      return;
    }

    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    const accessToken = tokenData.access_token as string;

    // Fetch user info with the access token
    const userRes = await fetch(HC_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      res.redirect("/?error=user_fetch_failed");
      return;
    }

    const userData = (await userRes.json()) as Record<string, unknown>;
    const userId =
      (userData.id as string) || (userData.email as string) || accessToken;
    const email = (userData.email as string) || "";
    const name =
      (userData.name as string) ||
      (userData.username as string) ||
      (userData.full_name as string) ||
      undefined;
    const avatar = (userData.avatar as string) || (userData.avatar_url as string) || undefined;

    // Load or create user
    let user = userStore.get(userId);
    if (!user) {
      user = {
        id: userId,
        email,
        name,
        avatar,
        customPresets: {},
      };
      userStore.set(userId, user);
    }

    // Update profile fields
    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    if (email) user.email = email;

    req.session.user = user;
    res.redirect("/");
  } catch {
    res.redirect("/?error=auth_failed");
  }
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {});
  res.redirect("/");
});

app.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const u = req.session.user;
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    hasGhToken: !!u.ghApiToken,
    hasAnthropicKey: !!u.anthropicApiKey,
  });
});

// ── User Settings (tokens) ───────────────────────────────
app.get("/api/settings", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const u = req.session.user;
  res.json({
    hasGhToken: !!u.ghApiToken,
    hasAnthropicKey: !!u.anthropicApiKey,
    // Return masked versions so UI can show something
    ghApiTokenHint: u.ghApiToken
      ? "..." + u.ghApiToken.slice(-4)
      : null,
    anthropicApiKeyHint: u.anthropicApiKey
      ? "..." + u.anthropicApiKey.slice(-4)
      : null,
  });
});

app.put("/api/settings", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { ghApiToken, anthropicApiKey } = req.body;

  if (ghApiToken !== undefined) {
    req.session.user.ghApiToken = ghApiToken || undefined;
  }
  if (anthropicApiKey !== undefined) {
    req.session.user.anthropicApiKey = anthropicApiKey || undefined;
  }

  // Persist to store
  userStore.set(req.session.user.id, req.session.user);

  res.json({ ok: true });
});

// ── User Presets ──────────────────────────────────────────
app.get("/api/presets", (req, res) => {
  // List built-in presets
  const presetsDir = resolve(__dirname, "../presets");
  let builtIn: string[] = [];
  if (existsSync(presetsDir)) {
    builtIn = readdirSync(presetsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  }

  // List user custom presets
  const custom = req.session.user
    ? Object.keys(req.session.user.customPresets)
    : [];

  res.json({ builtIn, custom });
});

app.get("/api/presets/:name", (req, res) => {
  const { name } = req.params;

  // Check user custom presets first
  if (req.session.user?.customPresets[name]) {
    res.json({ source: "custom", preset: req.session.user.customPresets[name] });
    return;
  }

  // Check built-in
  const presetsDir = resolve(__dirname, "../presets");
  const presetPath = resolve(presetsDir, `${name}.json`);
  if (existsSync(presetPath)) {
    const raw = JSON.parse(
      require("fs").readFileSync(presetPath, "utf-8")
    ) as PresetConfig;
    res.json({ source: "builtin", preset: raw });
    return;
  }

  res.status(404).json({ error: "Preset not found" });
});

app.post("/api/presets", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const preset = req.body as PresetConfig;
  if (!preset.name || !preset.checks) {
    res.status(400).json({ error: "Preset must have name and checks" });
    return;
  }

  const key = preset.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  req.session.user.customPresets[key] = preset;
  userStore.set(req.session.user.id, req.session.user);

  res.json({ ok: true, key });
});

app.put("/api/presets/:name", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { name } = req.params;
  const preset = req.body as PresetConfig;

  req.session.user.customPresets[name] = preset;
  userStore.set(req.session.user.id, req.session.user);

  res.json({ ok: true });
});

app.delete("/api/presets/:name", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { name } = req.params;
  delete req.session.user.customPresets[name];
  userStore.set(req.session.user.id, req.session.user);

  res.json({ ok: true });
});

// ── Helper: resolve API keys (user tokens > env vars) ────
function resolveKeys(session: typeof express.request.session) {
  const user = session.user;
  return {
    ghProxyApiKey: user?.ghApiToken || process.env.GH_PROXY_API_KEY,
    anthropicApiKey: user?.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
  };
}

// ── Helper: resolve preset (user custom > built-in) ──────
function resolvePreset(
  presetName: string,
  user?: UserSession
): string | PresetConfig {
  if (user?.customPresets[presetName]) {
    return user.customPresets[presetName];
  }
  return presetName;
}

// ── Single review ──────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { url, preset, hoursReported, journalCount, journal } = req.body;

  if (!url || !isValidGitHubUrl(url)) {
    res.status(400).json({ error: "Invalid GitHub URL" });
    return;
  }

  const keys = resolveKeys(req.session);
  const resolvedPreset = resolvePreset(
    preset || "default",
    req.session.user
  );

  try {
    const result = await reviewRepository(url, {
      ghProxyApiKey: keys.ghProxyApiKey,
      anthropicApiKey: keys.anthropicApiKey,
      preset: typeof resolvedPreset === "string" ? resolvedPreset : "default",
      presetConfig:
        typeof resolvedPreset === "object" ? resolvedPreset : undefined,
      hourContext: {
        hoursReported:
          hoursReported != null ? parseFloat(hoursReported) : undefined,
        journalCount:
          journalCount != null ? parseInt(journalCount, 10) : undefined,
        journal: journal || undefined,
      },
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Review failed",
    });
  }
});

// ── Batch review ───────────────────────────────────────────
const batchJobs = new Map<
  string,
  { status: string; results: unknown[]; total: number; completed: number }
>();

app.post("/api/batch", upload.single("csv"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No CSV file uploaded" });
    return;
  }

  const jobId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const preset = req.body?.preset || "default";
  const keys = resolveKeys(req.session);

  batchJobs.set(jobId, {
    status: "processing",
    results: [],
    total: 0,
    completed: 0,
  });

  res.json({ jobId, status: "processing" });

  // Process in background
  try {
    const rows = await readCsv(req.file.path);
    const job = batchJobs.get(jobId)!;
    job.total = rows.length;

    const results = await processBatch(rows, {
      ghProxyApiKey: keys.ghProxyApiKey,
      anthropicApiKey: keys.anthropicApiKey,
      preset,
      concurrency: 5,
      onProgress: (completed) => {
        job.completed = completed;
      },
    });

    job.status = "complete";
    job.results = results;

    // Cleanup upload
    try {
      unlinkSync(req.file!.path);
    } catch {}
  } catch (err) {
    const job = batchJobs.get(jobId);
    if (job) {
      job.status = "error";
    }
  }
});

app.get("/api/batch/:jobId", (req, res) => {
  const job = batchJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// ── Health ─────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  const keys = resolveKeys(req.session);
  res.json({
    status: "ok",
    version: "1.0.0",
    github: !!keys.ghProxyApiKey,
    ai: !!keys.anthropicApiKey,
  });
});

// ── Available checks (for preset builder) ─────────────────
app.get("/api/checks", (_req, res) => {
  res.json({
    checks: [
      {
        id: "github_link_works",
        name: "GitHub Link Works",
        description: "Validates the GitHub repository exists and contains files",
        type: "rule",
        configOptions: [],
      },
      {
        id: "readme_present",
        name: "README Present",
        description: "Checks that a README file exists in the repository",
        type: "rule",
        configOptions: [],
      },
      {
        id: "readme_quality",
        name: "README Quality",
        description:
          "Evaluates README for project description, build instructions, and structure",
        type: "ai",
        configOptions: [{ key: "severity", type: "select", options: ["fail", "warning"] }],
      },
      {
        id: "readme_has_project_image",
        name: "Project Image in README",
        description:
          "Detects project-relevant images (hardware photo, 3D render, PCB layout)",
        type: "ai",
        configOptions: [
          { key: "minimum_image_count", type: "number", default: 1 },
        ],
      },
      {
        id: "three_d_files_present",
        name: "3D/CAD Files Present",
        description:
          "Looks for 3D design files (.stl, .step, .3mf, .f3d, .scad, etc.)",
        type: "rule",
        configOptions: [
          { key: "minimum_file_count", type: "number", default: 1 },
          {
            key: "allowed_extensions",
            type: "text",
            default: ".stl,.step,.stp,.3mf,.obj,.f3d,.fcstd,.scad",
          },
        ],
      },
      {
        id: "pcb_files_present",
        name: "PCB Files Present",
        description:
          "Detects PCB design files from KiCad, EasyEDA, Eagle, Altium, or Gerber outputs",
        type: "rule",
        configOptions: [
          {
            key: "allowed_ecad_tools",
            type: "text",
            default: "kicad,easyeda,eagle,altium",
          },
          {
            key: "require_source_design_files",
            type: "boolean",
            default: true,
          },
        ],
      },
      {
        id: "bom_present_if_required",
        name: "BOM Present",
        description:
          "Looks for a Bill of Materials file (bom.csv, parts list, etc.)",
        type: "rule",
        configOptions: [
          { key: "severity", type: "select", options: ["fail", "warning"] },
        ],
      },
      {
        id: "source_code_present",
        name: "Source Code Present",
        description:
          "Checks that the repository contains actual source code files",
        type: "rule",
        configOptions: [
          { key: "minimum_file_count", type: "number", default: 3 },
        ],
      },
      {
        id: "gitignore_present",
        name: ".gitignore Present",
        description:
          "Checks for a .gitignore file to prevent committing build artifacts",
        type: "rule",
        configOptions: [],
      },
      {
        id: "package_manager_present",
        name: "Package Manager / Dependencies",
        description:
          "Detects package manager files (package.json, requirements.txt, Cargo.toml, etc.)",
        type: "rule",
        configOptions: [
          { key: "severity", type: "select", options: ["fail", "warning"] },
        ],
      },
      {
        id: "license_present",
        name: "License Present",
        description:
          "Checks for a LICENSE or COPYING file in the repository",
        type: "rule",
        configOptions: [],
      },
      {
        id: "code_quality_overview",
        name: "Code Quality Overview",
        description:
          "AI assessment of code structure, effort, and originality",
        type: "ai",
        configOptions: [
          { key: "severity", type: "select", options: ["fail", "warning"] },
        ],
      },
    ],
  });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`
  ╔═╗╔═╗╦═╗╔╗╔╔═╗╦  ╦╦ ╦╔═╗
  ║  ║ ║╠╦╝║║║║╣ ║  ║║ ║╚═╗
  ╚═╝╚═╝╩╚═╝╚╝╚═╝╩═╝╩╚═╝╚═╝
  ─── YSWS Review Engine ───

  Server running on http://localhost:${PORT}
  `);
});
