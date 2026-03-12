# Review Instructions: Software Strict

## readme_quality

Analyze this software project README with maximum scrutiny. This project must demonstrate professional-grade documentation. Check if it:

1. Has a clear, detailed project description explaining what the app does and the problem it solves
2. Explains the purpose, target audience, and unique value proposition
3. Has comprehensive setup/installation instructions OR a working link to the live site
4. Is well-structured with headings and sections
5. Mentions the tech stack, architecture, or key dependencies
6. Includes usage examples, API documentation, or screenshots
7. Has a contributing guide or at least mentions how to report issues

A "good" README should have at least 5 of the above. "Adequate" needs 3-4. "Poor" is anything less.

Return JSON:
{
  "quality": "good" | "adequate" | "poor",
  "hasDescription": boolean,
  "hasInstructions": boolean,
  "confidence": number 0-1,
  "reason": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}

## readme_has_project_image

Analyze this README and determine if it contains at least one image that appears to be a genuine project image (screenshot of the working app, UI mockup, demo GIF, architecture diagram, etc).

Stock images, badges, and logos do NOT count. The image must show the actual project in action or its design.

Return JSON: {"hasProjectImage": boolean, "confidence": number 0-1, "reason": "explanation"}

## code_quality_overview

You are performing a strict code quality review of a student software project for Hack Club. Apply high standards.

Assess the code quality based on these sample files:

1. **Originality**: Is this clearly original work? Not a tutorial copy, not a template with minor tweaks, not AI-generated boilerplate.
2. **Structure**: Is the code well-organized with proper separation of concerns? Are there meaningful modules/components?
3. **Logic depth**: Is there real business logic, algorithms, or data processing? Or is it just glue code connecting libraries?
4. **Error handling**: Does the code handle edge cases and errors?
5. **Code style**: Is naming consistent? Are there comments where needed? Is there dead code or obvious copy-paste?

Be rigorous. A "good" rating means genuinely well-written code. "Adequate" means functional but with clear room for improvement. "Poor" means significant issues.

Return JSON:
{
  "quality": "good" | "adequate" | "poor",
  "confidence": number 0-1,
  "reason": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}

## url_alive

Analyze this HTML content from a deployed website. Determine with high confidence whether this is a real, functional, actively-used web application.

Apply strict criteria:
- Real application content (navigation, interactive elements, meaningful text, dynamic data)
- Signs of a working app (forms, dynamic content areas, API references, user-specific content)
- Evidence of real users or real data (not just placeholder/lorem ipsum content)
- Proper error handling visible in the UI

Red flags that should FAIL:
- Default "Welcome to React/Next.js/Vite" pages
- 404 errors or domain parking pages
- Blank pages with only boilerplate HTML
- Pages that only show a logo and "coming soon"
- Template pages with no customization
- Placeholder content everywhere

Return JSON:
{
  "isReal": boolean,
  "confidence": number 0-1,
  "reason": "brief explanation of what the site appears to be"
}

## deep_code_review

You are a senior reviewer for Hack Club's YSWS (You Ship, We Ship) program performing a strict deep code review. Your job is to determine with high confidence whether this is a genuinely built, original, shipped piece of software.

Analyze the provided source code files, repository file tree, and README with maximum scrutiny.

Evaluate the following:

1. **Originality** (most important):
   - Is this original work by the student? Look for personalized variable names, custom logic, unique feature implementations.
   - Check for signs of AI generation: overly consistent style, generic variable names like "data", "result", "item", excessive comments explaining obvious code, suspiciously perfect error handling in a student project.
   - Check for template/scaffold indicators: default file structures from create-react-app, Next.js, Vite, etc. with minimal custom code added.
   - Check for tutorial copy-paste: matching known tutorial patterns, TODO comments from tutorials, sample data that matches popular courses.
   - If it's a fork, how much was actually changed from the original?

2. **Shipped Status**:
   - Does this project appear to be a real, functional, deployed application?
   - Multiple working features (not just a landing page)
   - Error handling and edge cases considered
   - Configuration for deployment (environment variables, build scripts, hosting config)
   - Evidence the app actually does something useful

3. **Architecture & Complexity**:
   - Frontend only, full-stack, API-only, CLI tool, etc.
   - How many distinct features or routes/pages are implemented?
   - Is there state management, data persistence, or external API integration?
   - Real algorithms or just CRUD operations?

4. **Effort & Iteration**:
   - Multiple components/modules working together
   - Evidence of debugging, refactoring, or iteration
   - Tests or at least testable code structure
   - Meaningful commit-worthy changes

5. **Red Flags** (any of these should heavily weigh toward failure):
   - Repo is just a framework starter with no custom code
   - All "custom" code is clearly from a tutorial
   - Very few files with meaningful logic (< 5 files of real code)
   - Project claims many hours but codebase is trivially small
   - Suspiciously perfect code quality for a claimed beginner
   - No .gitignore (suggests unfamiliarity with development practices)
   - Single commit with entire project

Return JSON:
{
  "isOriginal": boolean,
  "isShipped": boolean,
  "complexity": "simple" | "medium" | "complex",
  "featureCount": number,
  "architectureDescription": "brief description of the project architecture",
  "confidence": number 0-1,
  "reason": "2-3 sentence explanation of your assessment",
  "redFlags": ["flag1", "flag2"],
  "strengths": ["strength1", "strength2"]
}

## hour_estimation

You are a strict reviewer for Hack Club's YSWS program. You need to estimate how many hours this software project actually took. Apply skeptical analysis.

This is a strict review — err on the side of lower estimates. The trust score system has already flagged potential concerns.

Guidelines for hour estimation (strict software review):
- A simple static website or single-page app is 5-10 hours max
- A basic CRUD app or bot with a few features is 10-20 hours
- A full-stack app with auth, database, and multiple features is 20-50 hours
- Complex projects (real-time apps, game engines, compilers) can be 40-100 hours
- Using a framework scaffold or starter template counts for very little (0.5-1 hour)
- Copy-pasting tutorial code is not verifiable work — 0 hours for copied sections
- Setting up a git repo should be 0.5 hours max
- If trust score is below 40, cap estimate at minimum for project type
- If single-commit project, assume bulk upload and estimate conservatively
- Deployment setup and configuration: 1-3 hours depending on complexity

Strict rules:
- Journal entries must be specific and detailed to count at full value
- Vague entries like "worked on project" should be counted at 25% of claimed time
- If reported hours exceed 2x your estimate, explain the discrepancy
- Never give more hours than the code volume and complexity justify
- Cross-reference file count, code volume, and feature count against claimed hours

Write a natural, human-sounding justification (2-4 sentences). Be direct, specific, and blunt when needed.

Return JSON: {"hourEstimate": <number>, "justification": "<string>"}

## summary

Based on these review results for a software project under strict review, provide a thorough summary. This is a maximum-scrutiny review — be direct about any concerns.

The trust score system has analyzed this project across multiple dimensions. Your summary must:
1. State the trust score category and overall assessment
2. Call out any critical or warning flags specifically
3. Note the weakest scoring category and why
4. Give a clear recommendation: approve, reject, or needs-manual-review
5. If recommending approval, note any caveats

Return JSON: {"summary": "detailed summary", "fixes": ["fix1", "fix2"]}
