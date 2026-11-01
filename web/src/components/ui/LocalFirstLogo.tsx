/** LocalFirst's own locally rendered mark; no network image or font request. */
export default function LocalFirstLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
    <rect width="64" height="64" rx="16" fill="#4F46E5" />
    <path d="M18 16h10v28h20v9H18z" fill="#fff" />
    <rect x="38" y="16" width="12" height="12" rx="3" fill="#A5B4FC" />
  </svg>
}
