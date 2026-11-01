import { renderToStaticMarkup } from 'react-dom/server';

interface AccountPinProps {
  color: string;
  size?: number;
}

export function AccountPin({ color, size = 28 }: AccountPinProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 34"
      role="img"
      aria-hidden="true"
      style={{ color, display: 'block' }}
    >
      <path
        d="M14 1C6.8 1 1 6.8 1 14c0 9.2 13 19 13 19s13-9.8 13-19C27 6.8 21.2 1 14 1z"
        fill="currentColor"
        stroke="#ffffff"
        strokeWidth="2"
      />
      <circle cx="14" cy="12" r="3.4" fill="#ffffff" />
      <path d="M8.4 21.2c0-3.1 2.5-5.2 5.6-5.2s5.6 2.1 5.6 5.2v1.1H8.4z" fill="#ffffff" />
    </svg>
  );
}

export function accountPinMarkup(color: string, size = 28): string {
  return renderToStaticMarkup(<AccountPin color={color} size={size} />);
}
