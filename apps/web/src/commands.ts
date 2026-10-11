/**
 * The prompt's commands.
 *
 * A command is a name, a one-line summary for the palette, and a function. The palette and the
 * `/help` panel are both derived from this array and nothing else knows the list, so adding a
 * command is adding one entry here.
 *
 * A command only runs when it is picked from the palette. Typing `/new` and sending it is still a
 * prompt: a path may start with a slash, and quietly swallowing the message would be the wrong kind
 * of clever.
 */

export interface CommandContext {
  /** True while a process is attached. The commands that talk to the conversation need one. */
  attached: boolean;
  reset: () => void;
  compact: () => void;
  help: () => void;
  info: () => void;
  tree: () => void;
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
    name: "new",
    summary: "Start the session clean, dropping all context",
    available: (context) => context.attached,
    run: (context) => context.reset(),
  },
  {
    name: "compact",
    summary: "Compact the context now, instead of waiting for the threshold",
    available: (context) => context.attached,
    run: (context) => context.compact(),
  },
  {
    name: "help",
    summary: "Show every command",
    run: (context) => context.help(),
  },
  {
    name: "session",
    summary: "Show this session's details",
    run: (context) => context.info(),
  },
  {
    name: "tree",
    summary: "Jump to a message in this conversation",
    run: (context) => context.tree(),
  },
];
