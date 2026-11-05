/** The subset of `process` the integrations use (injectable for tests). */
export interface ProcessLike {
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
  listenerCount(event: string): number;
  exit(code?: number): void;
  kill(pid: number, signal?: string): unknown;
  pid: number;
  execArgv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number | string | null | undefined;
}

export const nodeProcess = process as unknown as ProcessLike;
