export function DataSurface({ as: Element = "section", children, className = "", ...props }) {
  const surfaceClassName = ["data-surface", className].filter(Boolean).join(" ");

  return (
    <Element className={surfaceClassName} {...props}>
      {children}
    </Element>
  );
}

export function SurfaceHeader({ actions, children }) {
  return (
    <div className="surface-header">
      {children}
      {actions || null}
    </div>
  );
}

export function MetricCard({ label, loading, value }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{loading ? "..." : value ?? 0}</strong>
    </article>
  );
}

export function ResponsiveTable({ children }) {
  return <div className="responsive-table">{children}</div>;
}
