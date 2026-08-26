// Small inline stroke icons. No emoji, no icon font: keeps the flat look and
// avoids a dependency.
type P = { size?: number; className?: string };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const MapIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <polygon points="9 4 3 6 3 20 9 18 15 20 21 18 21 4 15 6 9 4" />
    <line x1="9" y1="4" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="20" />
  </svg>
);

export const GridIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

export const InfoIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12" y2="8" />
  </svg>
);

export const DropIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z" />
  </svg>
);

export const SunIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
  </svg>
);

export const TruckIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="1" y="6" width="13" height="10" />
    <path d="M14 9h4l3 3v4h-7z" />
    <circle cx="6" cy="18" r="1.6" />
    <circle cx="17" cy="18" r="1.6" />
  </svg>
);

export const PumpIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h16" />
    <path d="M7 20v-6a5 5 0 0 1 10 0v6" />
    <path d="M12 9V4M9 4h6" />
  </svg>
);

export const PeopleIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" />
  </svg>
);

export const AlertIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l9 16H3z" />
    <line x1="12" y1="10" x2="12" y2="14" />
    <line x1="12" y1="17" x2="12" y2="17" />
  </svg>
);

export const FleetIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="4" />
    <rect x="3" y="10" width="18" height="4" />
    <rect x="3" y="16" width="18" height="4" />
  </svg>
);

export const EyeIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export const ClockIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.2V12l3.1 1.9" />
  </svg>
);

export const TargetIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" />
  </svg>
);

export const SearchIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </svg>
);

export const FilterIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </svg>
);

export const ResetIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8V3m0 0h5M4 3l3.5 3.5A8 8 0 1 1 4.3 14" />
  </svg>
);

export const ChevronDownIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m7 9 5 5 5-5" /></svg>
);

export const ChevronLeftIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m15 18-6-6 6-6" /></svg>
);

export const ChevronRightIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m9 18 6-6-6-6" /></svg>
);

export const CloseIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const MoreIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const ShieldIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 2.5 20 6v5.5c0 4.8-3.2 8.4-8 10-4.8-1.6-8-5.2-8-10V6z" />
    <path d="M7.5 13.5c1.4-1 2.8-1 4.5 0 1.7 1 3.1 1 4.5 0M8.5 10c1.1-.8 2.2-.8 3.5 0 1.3.8 2.4.8 3.5 0" />
  </svg>
);

export const DocumentIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <polyline points="14 3 14 8 19 8" />
    <line x1="8.5" y1="13" x2="15.5" y2="13" />
    <line x1="8.5" y1="16.5" x2="13" y2="16.5" />
  </svg>
);

export const LogoutIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
    <polyline points="15 8 19 12 15 16" />
    <line x1="19" y1="12" x2="10" y2="12" />
  </svg>
);
