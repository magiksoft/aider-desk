type Props = {
  width?: number;
  height?: number;
  className?: string;
};

export const AigrowIcon = ({ width = 64, height = 64, className }: Props) => (
  <div
    aria-label="AIGROW"
    className={`flex items-center justify-center rounded-md ${className || ''}`}
    style={{
      backgroundColor: '#0A0A0A',
      height: `${height}px`,
      width: `${width}px`,
    }}
  >
    <svg viewBox="0 0 24 24" width={width * 0.6} height={height * 0.6} fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>AIGROW</title>
      <path
        fill="white"
        fillRule="evenodd"
        transform="translate(4.91 18.86) scale(0.02)"
        d="M5 0 272 -686H436L704 0H563L508 -146H194L139 0ZM235 -256H466L397 -442Q393 -452 387.5 -467.5Q382 -483 376 -501.5Q370 -520 364 -539Q358 -558 353 -573H348Q342 -553 333.5 -527Q325 -501 317 -478Q309 -455 304 -442Z"
      />
    </svg>
  </div>
);
