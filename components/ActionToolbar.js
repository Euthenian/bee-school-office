export function ActionToolbar({ children, className = "", ...props }) {
  return <div className={["action-toolbar", className].filter(Boolean).join(" ")} {...props}>{children}</div>;
}
