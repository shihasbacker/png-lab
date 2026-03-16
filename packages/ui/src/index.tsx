import type { DragEventHandler, PropsWithChildren, ReactNode } from "react";

type PanelProps = PropsWithChildren<{
  eyebrow?: string;
  glow?: boolean;
  title: string;
}>;

type ActionButtonProps = PropsWithChildren<{
  disabled?: boolean;
  onClick?: () => void;
  tone?: "primary" | "ghost";
}>;

type StatusRowProps = {
  label: string;
  value: ReactNode;
};

type ErrorMessageProps = {
  message: string;
};

type PreviewFrameProps = PropsWithChildren<{
  caption: string;
}>;

type UploadSurfaceProps = {
  accept: string;
  disabled?: boolean;
  isDragging?: boolean;
  onBrowse: () => void;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
};

export function Panel({ children, eyebrow, glow = true, title }: PanelProps) {
  return (
    <section className={`ic-panel${glow ? "" : " ic-panel--no-glow"}`}>
      <div className="ic-panel__header">
        {eyebrow ? <p className="ic-panel__eyebrow">{eyebrow}</p> : null}
        <h2 className="ic-panel__title">{title}</h2>
      </div>
      <div className="ic-panel__body">{children}</div>
    </section>
  );
}

export function ActionButton({ children, disabled, onClick, tone = "primary" }: ActionButtonProps) {
  return (
    <button className={`ic-btn ic-btn--${tone}`} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function StatusRow({ label, value }: StatusRowProps) {
  return (
    <div className="ic-status-row">
      <span className="ic-status-row__label">{label}</span>
      <span className="ic-status-row__value">{value}</span>
    </div>
  );
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="ic-error">
      <span className="ic-error__label">Error</span>
      <p>{message}</p>
    </div>
  );
}

export function PreviewFrame({ caption, children }: PreviewFrameProps) {
  return (
    <div className="ic-preview-frame">
      <div className="ic-preview-frame__body">{children}</div>
      <div className="ic-preview-frame__caption">{caption}</div>
    </div>
  );
}

export function UploadSurface({
  accept,
  disabled,
  isDragging,
  onBrowse,
  onDragLeave,
  onDragOver,
  onDrop,
}: UploadSurfaceProps) {
  return (
    <div
      aria-disabled={disabled}
      className={`ic-upload-surface${isDragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="ic-upload-surface__index">Drop / Browse</span>
      <div className="ic-upload-surface__copy">
        <p>Drag artwork into the lab, or browse your device for a single file.</p>
        <span>{accept.replaceAll("image/", "").replaceAll(",", " / ")}</span>
      </div>
      <ActionButton disabled={disabled} onClick={onBrowse} tone="ghost">
        Choose file
      </ActionButton>
    </div>
  );
}
