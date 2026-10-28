const paths = {
  "arrow-left": <path d="M19 12H5m7-7-7 7 7 7" />,
  book: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Z" /><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
  "calendar-clock": <><path d="M3 10h18M7 3v4m10-4v4M3 18V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" /><circle cx="18" cy="18" r="4" /><path d="M18 16v2l1.5 1" /></>,
  check: <path d="m5 12.5 4.1 4L19 6.5" />,
  "check-list": <><path d="m4 7 2 2 3-4m3 2h8M4 17l2 2 3-4m3 2h8" /></>,
  document: <><path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6m-6 4h6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1 .9-1.7 1.3-1.7 2.7M12 17h.01" /></>,
  home: <><path d="m3 10 9-7 9 7v11H3V10Z" /><path d="M9 21v-7h6v7" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="3" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  money: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M5 8h.01M19 16h.01" /></>,
  more: <><circle cx="5" cy="12" r="1.75" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.75" fill="currentColor" stroke="none" /></>,
  pencil: <path d="m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Zm10-13 3 3" />,
  phone: <path d="M6.5 4.5 9 4l2 4-1.8 1.2a11 11 0 0 0 5.6 5.6L16 13l4 2-.5 2.5c-.2 1-1.1 1.7-2.1 1.6C10.5 18.6 5.4 13.5 4.9 6.6c-.1-1 .6-1.9 1.6-2.1Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  save: <><path d="M4 3h14l3 3v15H3V3h1Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
  school: <><path d="M3 21V8l9-5 9 5v13H3Z" /><path d="M9 21v-7h6v7M7 10h.01M17 10h.01" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  filter: <><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" /></>,
  pause: <><circle cx="12" cy="12" r="9" /><path d="M9 8v8m6-8v8" /></>,
  graduation: <><path d="m2 9 10-5 10 5-10 5L2 9Zm4 3v5c3 3 9 3 12 0v-5m4-3v7" /></>,
  send: <><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  trash: <path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3ZM17 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 4v2h-3" /></>,
  "user-plus": <><path d="M15 19c0-2.2-2.2-4-5-4s-5 1.8-5 4" /><circle cx="10" cy="8" r="3" /><path d="M19 8v6m-3-3h6" /></>
};

export function ActionIcon({ className = "action-icon", name }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
