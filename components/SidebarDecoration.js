export function SidebarDecoration() {
  return (
    <div aria-hidden="true" className="sidebar-decoration">
      <svg className="sidebar-decoration-waves" preserveAspectRatio="none" viewBox="0 0 248 124">
        <defs>
          <linearGradient id="sidebar-wave-cream" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff7e7" />
            <stop offset="1" stopColor="#ffefc6" />
          </linearGradient>
          <linearGradient id="sidebar-wave-gold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ffecc1" />
            <stop offset="1" stopColor="#ffdc8e" />
          </linearGradient>
        </defs>
        <path d="M0 67 C33 56 48 93 82 98 C117 104 133 83 161 71 C192 58 216 61 248 68 L248 124 L0 124 Z" fill="url(#sidebar-wave-cream)" />
        <path d="M0 88 C31 83 47 110 83 114 C119 118 141 103 169 89 C203 72 223 80 248 86 L248 124 L0 124 Z" fill="#ffe8b2" />
        <path d="M0 105 C31 97 52 119 85 122 C125 125 150 114 178 104 C207 94 229 96 248 105 L248 124 L0 124 Z" fill="url(#sidebar-wave-gold)" />
      </svg>
    </div>
  );
}
