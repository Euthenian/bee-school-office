import { formatPersonName } from "@/lib/format";

export function StudentAvatar({ student }) {
  const name = formatPersonName(student);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const tone = Array.from(String(student?.id || name)).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5;

  return <span aria-hidden="true" className={`student-avatar student-avatar-${tone}`}>{initials}</span>;
}
