import { type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A modal on the native `dialog` element. `showModal` brings the focus trap, Escape handling, the
 * inert background, and the backdrop with it, which is more than a hand-rolled overlay gets right.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // `cancel` fires on Escape; `close` fires on every path, including the programmatic one above.
  // Both feed the same state, and a repeat is a no-op.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const handle = (): void => onClose();
    element.addEventListener("cancel", handle);
    element.addEventListener("close", handle);
    return () => {
      element.removeEventListener("cancel", handle);
      element.removeEventListener("close", handle);
    };
  }, [onClose]);

  return (
    <dialog ref={dialog} className="modal" aria-labelledby={titleId}>
      <div className="modal-head">
        <h2 className="section-title grow" id={titleId}>
          {title}
        </h2>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
