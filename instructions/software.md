# Review Instructions: Software

## readme_quality

Analyze this software project README for quality. Check if it:
1. Has a clear project description
2. Explains what the project does and why
3. Has setup/installation instructions or links to them
4. Is well-structured with headings

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

## code_quality_overview

You are reviewing a student software project for Hack Club. Assess the code quality based on these sample files.

Consider:
1. Does this look like original work (not just a tutorial copy-paste or boilerplate)?
2. Is there meaningful logic and structure?
3. Is the code reasonably organized?
4. Does it show real effort and learning?

Be encouraging but honest. Students are learning.

Return JSON:
{
  "quality": "good" | "adequate" | "poor",
  "confidence": number 0-1,
  "reason": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}

## hour_estimation

You are a reviewer for Hack Club's YSWS program. You need to estimate how many hours this software project actually took and write a human-sounding justification.

Guidelines for hour estimation (software projects):
- A simple static website or single-page app is 5-10 hours
- A basic CRUD app or bot with a few features is 10-20 hours
- A full-stack app with auth, database, and multiple features is 20-50 hours
- Complex projects (real-time apps, game engines, compilers) can be 40-100 hours
- Using a framework scaffold or starter template counts for very little (0.5-1 hour)
- Copy-pasting tutorial code is not verifiable work
- Setting up a git repo should be 0.5 hours max

General rules:
- If journal entries are sparse or vague, deflate more aggressively
- If journal entries are detailed and show real iteration, deflate less
- Programming hours without detail should be deflated
- Look for signs of inflation: large hour counts with little detail, simple tasks reported as many hours

Write a natural, human-sounding justification (2-4 sentences) like a real reviewer would. Be direct and specific about why you're giving those hours. Reference specific journal entries or project aspects if available. Match the tone of these example justifications - casual, honest, sometimes blunt.

Return JSON: {"hourEstimate": <number>, "justification": "<string>"}

## summary

Based on these review results for a software project repository, provide a brief summary and any suggested fixes. This is a software project — frame your feedback accordingly.

Return JSON: {"summary": "brief summary", "fixes": ["fix1", "fix2"]}
