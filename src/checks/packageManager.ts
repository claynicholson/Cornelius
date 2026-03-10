import { BaseCheck } from "./base.js";
import type { CheckConfig, CheckResult, RepoContext } from "../core/types.js";

const DEPENDENCY_FILES: Record<string, string> = {
  "package.json": "Node.js (npm/yarn/pnpm)",
  "requirements.txt": "Python (pip)",
  "pyproject.toml": "Python (modern)",
  "setup.py": "Python (setuptools)",
  "Pipfile": "Python (pipenv)",
  "Cargo.toml": "Rust (cargo)",
  "go.mod": "Go",
  "Gemfile": "Ruby (bundler)",
  "pom.xml": "Java (Maven)",
  "build.gradle": "Java/Kotlin (Gradle)",
  "build.gradle.kts": "Kotlin (Gradle KTS)",
  "pubspec.yaml": "Dart/Flutter",
  "mix.exs": "Elixir (Mix)",
  "Makefile": "Make",
  "CMakeLists.txt": "C/C++ (CMake)",
  "composer.json": "PHP (Composer)",
  "deno.json": "Deno",
  "bun.lockb": "Bun",
};

export class PackageManagerCheck extends BaseCheck {
  id = "package_manager_present";
  name = "Package Manager / Dependencies";
  description = "Detects package manager or build system files.";

  async run(context: RepoContext, config: CheckConfig): Promise<CheckResult> {
    const blobs = context.tree
      .filter((e) => e.type === "blob")
      .map((e) => {
        const slash = e.path.lastIndexOf("/");
        return slash === -1 ? e.path : e.path.slice(slash + 1);
      });

    const detected: string[] = [];
    for (const [file, ecosystem] of Object.entries(DEPENDENCY_FILES)) {
      if (blobs.includes(file)) {
        detected.push(ecosystem);
      }
    }

    if (detected.length > 0) {
      return this.pass(
        `Detected: ${detected.join(", ")}`,
        detected,
        config,
      );
    }

    return this.warn(
      "No package manager or build system detected",
      [],
      config,
    );
  }
}
