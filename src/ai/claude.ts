import Anthropic from "@anthropic-ai/sdk";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number; // USD
}

// Pricing per million tokens (Claude Sonnet 4)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] || DEFAULT_PRICING;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  /** Accumulated usage across all calls in this client instance */
  totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
  /** Number of API calls made */
  callCount = 0;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || "claude-sonnet-4-20250514";
  }

  private trackUsage(response: Anthropic.Message): TokenUsage {
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = calcCost(this.model, inputTokens, outputTokens);

    this.totalUsage.inputTokens += inputTokens;
    this.totalUsage.outputTokens += outputTokens;
    this.totalUsage.cost += cost;
    this.callCount++;

    return { inputTokens, outputTokens, cost };
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

    this.trackUsage(response);

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

    this.trackUsage(response);

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
