export function PageHeader({ actions, className = "", decoration, description, eyebrow, title }) {
  return (
    <header className={["page-header", className].filter(Boolean).join(" ")}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {decoration || null}
      {actions ? <div>{actions}</div> : null}
    </header>
  );
}
