```
      ████████████████████████████████████
      █                                  █
      █   ██████╗ ██████╗ ██████╗ ███╗   █
      █  ██╔════╝██╔═══██╗██╔══██╗████╗  █
      █  ██║     ██║   ██║██████╔╝██╔██╗ █
      █  ██║     ██║   ██║██╔══██╗██║╚██╗█
      █  ╚██████╗╚██████╔╝██║  ██║██║ ╚████
      █   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ███
      █                                  █
      █  ███████╗██╗     ██╗██╗   ██╗███████
      █  ██╔════╝██║     ██║██║   ██║██╔════█
      █  █████╗  ██║     ██║██║   ██║███████╗█
      █  ██╔══╝  ██║     ██║██║   ██║╚════██║█
      █  ███████╗███████╗██║╚██████╔╝███████║█
      █  ╚══════╝╚══════╝╚═╝ ╚═════╝ ╚══════╝
      █                                  █
      ████████████████████████████████████
```

# CORNELIUS

**Hack Club YSWS Submission Review Engine**

Automated review system for [Hack Club](https://hackclub.com) YSWS (You Ship, We Ship) submissions. Validates hardware project repositories using rule-based checks and AI-powered analysis via Claude.

---

## Quick Start

```bash
# Install
npm install

# Set up environment
cp .env.example .env
# Edit .env with your GitHub token and Anthropic API key

# Review a single repo
npx tsx src/index.ts review https://github.com/owner/repo

# Batch review from CSV
npx tsx src/index.ts review batch submissions.csv -o results.csv

# Start web dashboard
npx tsx src/server.ts
```

## Features

- **Single & Batch Review** - Review one repo or hundreds via CSV
- **7 Built-in Checks** - GitHub link, README, images, 3D files, PCB files, BOM, README quality
- **AI-Powered Analysis** - Claude evaluates README quality, image relevance, and ambiguous cases
- **Configurable Presets** - Per-program review rules (Blueprint, Hackpad, custom)
- **Web Dashboard** - Browser UI for reviews and batch uploads
- **CLI Tool** - Full-featured command-line interface with colored output
- **Export Results** - CSV or JSON output for batch reviews

## Checks

| Check | Description | AI? |
|-------|-------------|-----|
| `github_link_works` | Repo exists and is accessible | No |
| `readme_present` | README file exists at root | No |
| `readme_quality` | README is well-written with description and instructions | Yes |
| `readme_has_project_image` | README contains project photos/renders | Yes |
| `three_d_files_present` | 3D design files (.stl, .step, .f3d, etc.) | No |
| `pcb_files_present` | PCB source files (KiCad, EasyEDA, Eagle, Altium) | No |
| `bom_present_if_required` | Bill of materials file or README section | No |

## Presets

Create custom presets in the `presets/` directory:

```json
{
  "name": "My Program",
  "projectType": "hardware",
  "checks": {
    "github_link_works": { "enabled": true, "required": true },
    "three_d_files_present": { "enabled": true, "required": false, "severity": "warning" }
  }
}
```

## CSV Format

Input CSV requires a `github_url` column. Optional columns:

```csv
github_url,project_type,submission_id,participant_name
https://github.com/user/project1,hardware,001,Alice
https://github.com/user/project2,hardware,002,Bob
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GH_PROXY_API_KEY` | Recommended | Hack Club GitHub Proxy API key ([docs](https://gh-proxy.hackclub.com/docs)) |
| `ANTHROPIC_API_KEY` | Optional | Enables AI-powered checks |
| `PORT` | Optional | Web server port (default: 3000) |

## Architecture

```
src/
├── index.ts          # CLI entry point
├── server.ts         # Web server (Express)
├── core/
│   ├── types.ts      # Shared type definitions
│   ├── reviewer.ts   # Review orchestrator
│   └── preset.ts     # Preset config loader
├── checks/           # Individual check implementations
├── github/           # GitHub API client
├── ai/               # Claude API wrapper
├── batch/            # CSV processing
├── cli/              # Terminal output formatting
└── web/public/       # Web dashboard
```

## License

MIT
