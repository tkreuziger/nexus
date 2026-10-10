import type { SessionStatus } from "@nexus/client";

/** Tag styling per session status: a live process, a clean stop, or a failure. */
export const SESSION_STATUS_CLASS: Record<SessionStatus, string> = {
  running: "tag live",
  idle: "tag ok",
  crashed: "tag bad",
  stopped: "tag",
  starting: "tag",
};

/** A session with a live harness process behind it. */
export const isActive = (status: SessionStatus): boolean =>
  status === "starting" || status === "running" || status === "idle";
