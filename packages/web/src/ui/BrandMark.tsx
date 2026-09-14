type BrandMarkProps = {
  size?: number;
  title?: string;
};

/** Exponential's rising path, kept as SVG so it stays sharp from favicon to display size. */
export function BrandMark({ size = 20, title }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="exponential-mark" x1="5" y1="6" x2="27" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D5EF8" />
          <stop offset="0.55" stopColor="#526FEB" />
          <stop offset="1" stopColor="#25B9AE" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#exponential-mark)" />
      <path d="M8.5 9.4 14 14.9M19.2 20.1l4.3 4.3" fill="none" stroke="#fff" strokeWidth="3.25" strokeLinecap="round" opacity=".58" />
      <path d="M7.4 22.5c6.7 0 12.2-3.8 15.4-11.5" fill="none" stroke="#fff" strokeWidth="3.7" strokeLinecap="round" />
      <path d="m19.3 10.1 5.6-1.7-.7 5.8Z" fill="#fff" stroke="#fff" strokeWidth="1.15" strokeLinejoin="round" />
    </svg>
  );
}
