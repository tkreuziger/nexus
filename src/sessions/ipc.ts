import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import {
  type ConfigureParams,
  type InitParams,
  type InitResult,
  SERVER_METHODS,
  type SubmitParams,
  type SubmitResult,
} from "../protocol/messages.ts";
import { type FrameChannel, JsonRpc } from "../protocol/rpc.ts";

/** Wrap a child process's stdio as a frame channel (ADR-1). */
export function childChannel(child: ChildProcess): FrameChannel {
  const { stdin, stdout } = child;
  if (stdin === null || stdout === null) {
    throw new Error("harness process has no stdio pipes");
  }
  return {
    lines: createInterface({ input: stdout }),
    write: (text) => stdin.write(text),
  };
}

/** Typed, direction-aware client for one harness process. */
export class HarnessClient {
  readonly rpc: JsonRpc;

  constructor(channel: FrameChannel) {
    this.rpc = new JsonRpc(channel);
  }

  start(): void {
    this.rpc.start();
  }

  init(params: InitParams): Promise<InitResult> {
    return this.rpc.request<InitResult>(SERVER_METHODS.init, params);
  }

  async configure(params: ConfigureParams): Promise<void> {
    await this.rpc.request(SERVER_METHODS.configure, params);
  }

  async reset(): Promise<void> {
    await this.rpc.request(SERVER_METHODS.reset, {});
  }

  async compact(): Promise<void> {
    await this.rpc.request(SERVER_METHODS.compact, {});
  }

  submit(params: SubmitParams): Promise<SubmitResult> {
    return this.rpc.request<SubmitResult>(SERVER_METHODS.submit, params);
  }

  async abort(): Promise<void> {
    await this.rpc.request(SERVER_METHODS.abort, {});
  }

  async subscribe(subscriptionId: string): Promise<void> {
    await this.rpc.request(SERVER_METHODS.subscribe, { subscriptionId });
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.rpc.request(SERVER_METHODS.unsubscribe, { subscriptionId });
  }

  async shutdown(): Promise<void> {
    await this.rpc.request(SERVER_METHODS.shutdown, {});
  }

  close(): void {
    this.rpc.close();
  }
}
