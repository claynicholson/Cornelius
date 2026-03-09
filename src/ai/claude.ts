import Anthropic from "@anthropic-ai/sdk";

export class ClaudeClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || "claude-sonnet-4-20250514";
  }

  async ask(prompt: string, content: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\n---\n\n${content}`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type === "text") {
      return block.text;
    }
    return "";
  }

  async askStructured<T>(
    prompt: string,
    content: string
  ): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nYou MUST respond with valid JSON only. No markdown, no code fences, no explanation outside the JSON.\n\n---\n\n${content}`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type === "text") {
      const cleaned = block.text
        .replace(/^```(?:json)?\s*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim();
      return JSON.parse(cleaned) as T;
    }
    throw new Error("Unexpected response format from Claude");
  }
}
