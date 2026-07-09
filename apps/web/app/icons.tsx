// Presentational SVG icons for the editor chrome. Each is sized for its call
// site and marked aria-hidden, so the surrounding button carries the label.

export function SidebarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M6 3.5h7L18 8v12a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M13 3.5V8h4.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.6" />
      <line x1="15.6" y1="15.6" x2="20" y2="20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M9 4.5h6l-1 4.6 2.6 2.9V13.4H7.4v-1.4L10 9.1 9 4.5Z" strokeLinejoin="round" />
      <line x1="12" y1="13.4" x2="12" y2="19.5" strokeLinecap="round" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4.5 19.5 6 14l9.9-9.9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L10 18l-5.5 1.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m14.5 5.5 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M3.8 12s3-5.5 8.2-5.5 8.2 5.5 8.2 5.5-3 5.5-8.2 5.5S3.8 12 3.8 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="18" cy="5.5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="18.5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m8.4 10.9 7.2-4M8.4 13.1l7.2 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M12 4.5v9.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m8.4 10.6 3.6 3.6 3.6-3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17.5v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SaveStatusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M5.2 12.5 9.3 16.6 18.8 7.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
