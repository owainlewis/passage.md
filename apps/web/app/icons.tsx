// Presentational SVG icons for the writer chrome. One size, one stroke
// weight, one grid, so every control in the bar sits on the same optical
// line. Each is aria-hidden; the surrounding button carries the label.

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PanelIcon() {
  return (
    <Icon>
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5" />
      <path d="M9.25 4.75v14.5" />
    </Icon>
  );
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5.75v12.5M5.75 12h12.5" />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 3.75 3.75" />
    </Icon>
  );
}

export function MoreIcon() {
  return (
    <Icon>
      <circle cx="6" cy="12" r=".75" fill="currentColor" />
      <circle cx="12" cy="12" r=".75" fill="currentColor" />
      <circle cx="18" cy="12" r=".75" fill="currentColor" />
    </Icon>
  );
}

export function UserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8.75" r="3.5" />
      <path d="M5.25 19.25c.9-3.2 3.6-5 6.75-5s5.85 1.8 6.75 5" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="m6.75 6.75 10.5 10.5M17.25 6.75l-10.5 10.5" />
    </Icon>
  );
}
