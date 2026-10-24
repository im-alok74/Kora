/// <reference lib="webworker" />
import { NeedsMainThread } from './imageWork';
import { TASKS, type TaskName } from './toolTasks';
import { PdfProblem } from './pdfOps';

// One worker for the file tools: pdf-lib work and picture work run here, so the page stays responsive while a big file is processed.
type Request = { id: number; task: TaskName; args: unknown[] };

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, task, args } = e.data;
  try {
    const run = TASKS[task] as (r: (m: string) => void, ...a: unknown[]) => Promise<unknown>;
    const value = await run((message) => self.postMessage({ id, progress: message }), ...args);
    self.postMessage({ id, value });
  } catch (err) {
    const error = err as Error;
    self.postMessage({ id, error: { message: error?.message ?? 'The task failed.', reason: err instanceof PdfProblem ? err.reason : undefined, mainThread: err instanceof NeedsMainThread } });
  }
};
