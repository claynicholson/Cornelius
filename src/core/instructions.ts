import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_DIR = resolve(__dirname, "../../instructions");

const cache = new Map<string, Record<string, string>>();

/**
 * Load and parse a markdown instruction file by name.
 * Splits by `## section_name` headings into a Record<string, string>.
 * Returns empty map if file not found.
 */
export function loadInstructions(name: string): Record<string, string> {
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  const filePath = resolve(INSTRUCTIONS_DIR, `${name}.md`);
  if (!existsSync(filePath)) {
    console.warn(`[cornelius] Instruction file not found: ${filePath}`);
    cache.set(name, {});
    return {};
  }

  const content = readFileSync(filePath, "utf-8");
  const sections: Record<string, string> = {};

  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(/^## (\S+)\s*$/);
    if (match) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = match[1];
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  cache.set(name, sections);
  return sections;
}
