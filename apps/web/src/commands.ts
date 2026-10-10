/**
 * The prompt's commands.
 *
 * A command is a name, a one-line summary for the palette, and a function. The palette is derived
 * from this array and nothing else knows the list, so adding a command is adding one entry here.
 *
 * A command only runs when it is picked from the palette. Typing `/abort` and sending it is still a
 * prompt: the model may well want to be told about a path that starts with a slash, and quietly
 * swallowing the message would be the wrong kind of clever.
 */

export interface CommandContext {
  /** Whether a turn is in flight, which is what `abort` is for. */
  running: boolean;
  abort: () => void;
  restart: () => void;
  expand: () => void;
  clear: () => void;
}

export interface Command {
  name: string;
  summary: string;
  /** Absent means always offered; otherwise the command is hidden while this returns false. */
  available?(context: CommandContext): boolean;
  run(context: CommandContext): void;
}

export const COMMANDS: readonly Command[] = [
  {
    name: "abort",
    summary: "Stop the turn that is running",
    available: (context) => context.running,
    run: (context) => context.abort(),
  },
  {
    name: "restart",
    summary: "Restart the session's process",
    run: (context) => context.restart(),
  },
  {
    name: "expand",
    summary: "Open the prompt in a large editor",
    run: (context) => context.expand(),
  },
  {
    name: "clear",
    summary: "Clear the prompt",
    run: (context) => context.clear(),
  },
];
