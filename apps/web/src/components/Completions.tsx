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
 * The list above the prompt: commands after `/`, worktree files after `@`.
 *
 * Options are buttons with `role="option"`, and the prompt keeps focus throughout — hence the
 * `onMouseDown` that refuses the pointer. Keyboard handling lives in the composer's own `onKeyDown`,
 * because that is where the caret is.
 */
export function Completions({
  id,
  options,
  selected,
  onPick,
  onHover,
}: {
  id: string;
  options: readonly CompletionOption[];
  selected: number;
  onPick: (option: CompletionOption) => void;
  onHover: (index: number) => void;
}): ReactElement | null {
  if (options.length === 0) return null;
  return (
    <div className="completions" id={id} role="listbox" aria-label="Completions">
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
  );
}
