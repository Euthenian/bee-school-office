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

export function MetricCard({ description, icon, label, loading, tone = "neutral", value }) {
  return (
    <article className={`metric-card ${icon ? `metric-card-illustrated tone-${tone}` : ""}`}>
      {icon ? <span className="metric-card-icon">{icon}</span> : null}
      <div>
        <p>{label}</p>
        <strong>{loading ? "..." : value ?? 0}</strong>
        {description ? <small>{description}</small> : null}
      </div>
    </article>
  );
}

export function FilterPanel({ actions, children, icon, title }) {
  return (
    <section className="filter-panel">
      <div className="filter-panel-heading">
        <h2>{icon ? <span className="filter-panel-icon">{icon}</span> : null}{title}</h2>
        {actions || null}
      </div>
      <div className="filter-panel-fields">{children}</div>
    </section>
  );
}

export function ResponsiveTable({ children }) {
  return <div className="responsive-table">{children}</div>;
}
