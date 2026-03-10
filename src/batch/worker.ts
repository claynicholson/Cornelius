import { parentPort, workerData } from "worker_threads";
import { reviewRepository } from "../core/reviewer.js";
import type { ReviewOptions, HourContext } from "../core/reviewer.js";

interface WorkerTask {
  url: string;
  options: {
    ghProxyApiKey?: string;
    anthropicApiKey?: string;
    preset?: string;
    hourContext?: HourContext;
  };
}

if (parentPort) {
  parentPort.on("message", async (task: WorkerTask) => {
    try {
      const result = await reviewRepository(task.url, task.options);
      parentPort!.postMessage({ type: "result", result });
    } catch (err) {
      parentPort!.postMessage({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
