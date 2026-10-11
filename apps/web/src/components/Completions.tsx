import type { ReactElement } from "react";

export interface CompletionOption {
  id: string;
  label: string;
  detail: string;
  /** Indices in `label` that the query matched, so the list can show why a row is there. */
  indices: number[];
  /** Present for commands. A mention has none: picking it inserts the path instead. */
  run?: () => void;
}

/** Mark the characters the query matched, so a fuzzy hit explains itself. */
function Highlighted({ text, indices }: { text: string; indices: number[] }): ReactElement {
  const matched = new Set(indices);
  const segments: { at: number; text: string; hit: boolean }[] = [];
  for (const [index, character] of [...text].entries()) {
    const hit = matched.has(index);
    const last = segments[segments.length - 1];
    if (last !== undefined && last.hit === hit) last.text += character;
    else segments.push({ at: index, text: character, hit });
  }
  return (
    <>
      {segments.map((segment) =>
        segment.hit ? (
          <mark key={segment.at}>{segment.text}</mark>
        ) : (
          <span key={segment.at}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The completion chooser, centred: commands after `/`, worktree files after `@`.
 *
 * It reads as a modal because a command is not part of the prompt — picking one runs it and takes
 * the token away, rather than composing text. But it deliberately is not a `<dialog>`: the prompt
 * has to keep the caret while this is up, so the pointer is refused on mousedown and focus never
 * moves. The scrim takes a click to dismiss, and Escape is handled by the composer's own key handler
 * because that is where the keyboard still is.
 */
export function Completions({
  id,
  title,
  options,
  selected,
  onPick,
  onHover,
  onDismiss,
}: {
  id: string;
  title: string;
  options: readonly CompletionOption[];
  selected: number;
  onPick: (option: CompletionOption) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
}): ReactElement | null {
  if (options.length === 0) return null;
  return (
    <div className="completions-overlay">
      <button
        type="button"
        className="completions-scrim"
        aria-label="Dismiss completions"
        tabIndex={-1}
        // Refused so the click does not move focus out of the prompt, which would close the list.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDismiss}
      />
      <div className="completions-panel">
        <p className="completions-title muted">{title}</p>
        <div className="completions" id={id} role="listbox" aria-label={title}>
          {options.map((option, index) => (
            <button
              key={option.id}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-selected={index === selected}
              className={index === selected ? "completion is-selected" : "completion"}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(option)}
            >
              <span className="completion-label mono">
                <Highlighted text={option.label} indices={option.indices} />
              </span>
              {option.detail === "" ? null : (
                <span className="completion-detail muted">{option.detail}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
