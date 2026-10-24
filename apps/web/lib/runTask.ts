import { PdfProblem } from './pdfPages';
import type { TaskArgs, TaskName, TaskResult } from './toolTasks';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (m: string) => void; redo: () => Promise<unknown> };
let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(why: Error) {
  worker?.terminate(); worker = null;
  for (const [id, p] of pending) { pending.delete(id); p.redo().then(p.resolve, p.reject); }   // anything in flight is run again on the page
  void why;
}

function start(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./toolWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; value?: unknown; progress?: string; error?: { message: string; reason?: PdfProblem['reason']; mainThread?: boolean } }>) => {
      const { id, value, progress, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress !== undefined) { p.progress?.(progress); return; }
      pending.delete(id);
      if (!error) p.resolve(value);
      else if (error.mainThread) p.redo().then(p.resolve, p.reject);
      else p.reject(error.reason ? new PdfProblem(error.reason, error.message) : new Error(error.message));
    };
    w.onerror = () => { broken = true; failAll(new Error('worker failed')); };
    worker = w;
    return w;
  } catch { broken = true; return null; }
}

/** Runs a slow task in the background worker. If the browser has no usable worker, it runs on the page instead, with the same result. */
export async function runTask<K extends TaskName>(task: K, args: TaskArgs<K>, progress?: (m: string) => void): Promise<TaskResult<K>> {
  const onPage = async () => {
    const { TASKS } = await import('./toolTasks');
    return (TASKS[task] as (r: (m: string) => void, ...a: unknown[]) => Promise<unknown>)(progress ?? (() => {}), ...(args as unknown[]));
  };
  const w = start();
  if (!w) return onPage() as Promise<TaskResult<K>>;
  const id = nextId++;
  return new Promise<TaskResult<K>>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress, redo: onPage });
    w.postMessage({ id, task, args });
  });
}
