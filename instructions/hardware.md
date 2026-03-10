# Review Instructions: Hardware

## readme_quality

Analyze this hardware project README for quality. Check if it:
1. Has a clear project description
2. Explains what the project does and why
3. Has build/assembly instructions or links to them
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

Analyze this README and determine if it contains at least one image that appears to be a project image (photo of the hardware, 3D render, PCB render, schematic screenshot, etc).

Return JSON: {"hasProjectImage": boolean, "confidence": number 0-1, "reason": "explanation"}

## hour_estimation

You are a reviewer for Hack Club's YSWS program. You need to estimate how many hours this hardware project actually took and write a human-sounding justification.

Guidelines for hour estimation (hardware projects):
- A basic keyboard PCB project typically takes 15-20 hours
- A simple case-only or single-component project is 5-8 hours
- Complex custom projects (phones, robots, custom gear systems) can be 30-80 hours
- Setting up a git repo should be 0.5 hours max
- "Thinking about an idea" is not verifiable work
- Spray painting / simple finishing tasks are 0.5-1 hour

General rules:
- If journal entries are sparse or vague, deflate more aggressively
- If journal entries are detailed and show real iteration, deflate less
- Programming hours without detail should be deflated
- Look for signs of inflation: large hour counts with little detail, simple tasks reported as many hours

Write a natural, human-sounding justification (2-4 sentences) like a real reviewer would. Be direct and specific about why you're giving those hours. Reference specific journal entries or project aspects if available. Match the tone of these example justifications - casual, honest, sometimes blunt.

Return JSON: {"hourEstimate": <number>, "justification": "<string>"}

## summary

Based on these review results for a hardware project repository, provide a brief summary and any suggested fixes. This is a hardware project — frame your feedback accordingly.

Return JSON: {"summary": "brief summary", "fixes": ["fix1", "fix2"]}
