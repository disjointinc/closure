import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  empty,
  expandable,
  keyOf,
  rows,
  rowHref,
}: {
  columns: Column<T>[];
  empty: string;
  /** Renders an expandable detail row beneath a row when clicked. */
  expandable?: (row: T) => ReactNode;
  keyOf: (row: T) => string;
  rows: T[];
  rowHref?: (row: T) => string;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <div className="tablewrap">
        <div className="empty">{empty}</div>
      </div>
    );
  }
  return (
    <div className="tablewrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = keyOf(row);
            const href = rowHref?.(row);
            const canExpand = expandable !== undefined;
            return [
              <tr
                key={key}
                className={href || canExpand ? "clickable" : undefined}
                onClick={() => {
                  if (href) {
                    void navigate({ href });
                    return;
                  }
                  if (canExpand) {
                    setExpanded(expanded === key ? null : key);
                  }
                }}
              >
                {columns.map((column) => (
                  <td key={column.header}>{column.cell(row)}</td>
                ))}
              </tr>,
              canExpand && expanded === key ? (
                <tr key={`${key}-detail`}>
                  <td colSpan={columns.length}>
                    <pre className="snippet">{expandable(row)}</pre>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export function IdCell({ id }: { id: string }) {
  return <code className="mono">{id}</code>;
}
