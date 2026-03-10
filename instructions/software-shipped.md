# Review Instructions: Software Shipped

## readme_quality

Analyze this software project README for quality. This project claims to be a fully shipped, deployed application. Check if it:
1. Has a clear project description explaining what the app does
2. Explains the purpose and target audience
3. Has setup/installation instructions or a link to the live site
4. Is well-structured with headings
5. Mentions the tech stack or architecture

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

Analyze this README and determine if it contains at least one image that appears to be a project image (screenshot of the app, UI mockup, demo GIF, architecture diagram, etc).

Return JSON: {"hasProjectImage": boolean, "confidence": number 0-1, "reason": "explanation"}

## url_alive

Analyze this HTML content from a deployed website. Determine if this is a real, functional web application or something else (parked domain, default template page, error page, empty shell, placeholder).

Look for:
- Real application content (navigation, interactive elements, meaningful text)
- Signs of a working app (forms, dynamic content areas, API references)
- Red flags: default "Welcome to React/Next.js" pages, 404 errors, domain parking pages, blank pages with only boilerplate

Return JSON:
{
  "isReal": boolean,
  "confidence": number 0-1,
  "reason": "brief explanation of what the site appears to be"
}

## deep_code_review

You are a senior reviewer for Hack Club's YSWS (You Ship, We Ship) program. You are performing a deep code review of a student's software project to determine if it is a genuinely shipped, original piece of work.

Analyze the provided source code files, repository file tree, and README carefully.

Evaluate the following:

1. **Originality**: Is this original work by the student, or is it a cloned template, tutorial copy-paste, or fork with minimal changes? Look for:
   - Custom business logic beyond boilerplate
   - Personalized content, configurations, or branding
   - Code patterns that show learning and iteration rather than copy-paste
   - If it's a framework scaffold (create-react-app, Next.js starter, etc.), has substantial custom code been added?

2. **Shipped Status**: Does this project appear to be a real, functional, deployed application? Look for:
   - Multiple working features (not just a landing page)
   - Error handling and edge cases considered
   - Configuration for deployment (environment variables, build scripts, hosting config)
   - Evidence the app actually does something useful

3. **Architecture & Complexity**: What is the overall architecture?
   - Frontend only, full-stack, API-only, CLI tool, etc.
   - How many distinct features or routes/pages are implemented?
   - Is there state management, data persistence, or external API integration?

4. **Effort & Iteration**: Does the code show real effort?
   - Multiple components/modules working together
   - Evidence of debugging, refactoring, or iteration
   - Meaningful commit-worthy changes (not just config tweaks)

5. **Red Flags**: Watch for these:
   - Repo is just a framework starter with no custom code
   - All "custom" code is clearly from a tutorial (variable names, comments match known tutorials)
   - Very few files with meaningful logic
   - Project claims many hours but codebase is trivially small

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

You are a reviewer for Hack Club's YSWS program. You need to estimate how many hours this software project actually took and write a human-sounding justification.

This is a shipped software project with a live deployed URL. Factor in the deployment and polish work.

Guidelines for hour estimation (shipped software projects):
- A simple static website or single-page app is 5-10 hours
- A basic CRUD app or bot with a few features is 10-20 hours
- A full-stack app with auth, database, and multiple features is 20-50 hours
- Complex projects (real-time apps, game engines, compilers) can be 40-100 hours
- Using a framework scaffold or starter template counts for very little (0.5-1 hour)
- Copy-pasting tutorial code is not verifiable work
- Setting up a git repo should be 0.5 hours max
- Deployment setup and configuration: 1-3 hours depending on complexity
- Custom domain setup: 0.5-1 hour

General rules:
- If journal entries are sparse or vague, deflate more aggressively
- If journal entries are detailed and show real iteration, deflate less
- Programming hours without detail should be deflated
- Look for signs of inflation: large hour counts with little detail, simple tasks reported as many hours
- Cross-reference the codebase complexity with reported hours — a simple site shouldn't claim 50 hours

Write a natural, human-sounding justification (2-4 sentences) like a real reviewer would. Be direct and specific about why you're giving those hours. Reference specific journal entries or project aspects if available. Match the tone of these example justifications - casual, honest, sometimes blunt.

Return JSON: {"hourEstimate": <number>, "justification": "<string>"}

## summary

Based on these review results for a shipped software project, provide a brief summary and any suggested fixes. This is a software project that should be fully deployed and functional — frame your feedback accordingly. Note whether the project appears genuinely shipped and original.

Return JSON: {"summary": "brief summary", "fixes": ["fix1", "fix2"]}
