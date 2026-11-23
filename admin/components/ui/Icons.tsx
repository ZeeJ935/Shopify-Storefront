// Small inline SVG icon set (no icon font or CDN, so the CSP stays strict).
type Props = { className?: string };
const base = (path: React.ReactNode, { className = "size-5" }: Props) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {path}
  </svg>
);

export const HomeIcon = (p: Props) => base(<path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3v-5h-5v5h-3a1 1 0 0 1-1-1V9Z" />, p);
export const OrdersIcon = (p: Props) => base(<><path d="M4 4.5h12v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11Z" /><path d="M4 4.5 5.5 2.5h9L16 4.5M7.5 8a2.5 2.5 0 0 0 5 0" /></>, p);
export const InventoryIcon = (p: Props) => base(<><path d="m10 2.5 7 3.5v8l-7 3.5L3 14V6l7-3.5Z" /><path d="m3 6 7 3.5L17 6M10 9.5v8" /></>, p);
export const AuditIcon = (p: Props) => base(<><path d="M5 2.5h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" /><path d="M7 9h6M7 12h6M7 15h3" /></>, p);
export const SearchIcon = (p: Props) => base(<><circle cx="8.5" cy="8.5" r="5" /><path d="m16.5 16.5-4.2-4.2" /></>, p);
export const MenuIcon = (p: Props) => base(<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />, p);
export const CloseIcon = (p: Props) => base(<path d="m5 5 10 10M15 5 5 15" />, p);
export const ChevronLeftIcon = (p: Props) => base(<path d="m12 4.5-5.5 5.5 5.5 5.5" />, p);
export const ChevronRightIcon = (p: Props) => base(<path d="m8 4.5 5.5 5.5L8 15.5" />, p);
export const ChevronDownIcon = (p: Props) => base(<path d="m5 7.5 5 5 5-5" />, p);
export const ExternalIcon = (p: Props) => base(<path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8" />, p);
export const CheckIcon = (p: Props) => base(<path d="m4.5 10.5 3.5 3.5 7.5-8" />, p);
export const AlertIcon = (p: Props) => base(<><circle cx="10" cy="10" r="7" /><path d="M10 6.5v4M10 13.5v.01" /></>, p);
export const InfoIcon = (p: Props) => base(<><circle cx="10" cy="10" r="7" /><path d="M10 9.5v4M10 6.5v.01" /></>, p);
export const SyncIcon = (p: Props) => base(<><path d="M16 7a6.5 6.5 0 0 0-11.7-1.5M4 13a6.5 6.5 0 0 0 11.7 1.5" /><path d="M16 3v4h-4M4 17v-4h4" /></>, p);
export const LogoutIcon = (p: Props) => base(<><path d="M8 16.5H4.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H8" /><path d="m12.5 13.5 3.5-3.5-3.5-3.5M16 10H8" /></>, p);
export const TruckIcon = (p: Props) => base(<><path d="M2.5 5h9v8h-9zM11.5 8h3l3 3v2h-6" /><circle cx="6" cy="14.5" r="1.5" /><circle cx="14.5" cy="14.5" r="1.5" /></>, p);
