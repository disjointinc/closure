import type { ReactNode } from "react";

export function Page({
  children,
  sub,
  title,
}: {
  children: ReactNode;
  sub?: string;
  title: string;
}) {
  return (
    <div>
      <h1>{title}</h1>
      {sub ? <p className="page-sub">{sub}</p> : null}
      {children}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (error === null) {
    return null;
  }
  return <div className="error">{messageOf({ error })}</div>;
}

export function NoteBox({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

export function messageOf({ error }: { error: unknown }): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function fmtTimestamp(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

/** Microcredits to a readable credit count. */
export function fmtCredits(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${(value / 1_000_000).toLocaleString()} cr`;
}

/** Pretty-printed JSON for expandable detail rows. */
export function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function Spinner() {
  return <p className="muted">Loading…</p>;
}
