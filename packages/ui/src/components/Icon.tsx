import React from "react";

// Inline SVG icons from Heroicons v2 (heroicons.com), outline style.
// Usage: <Icon name="x-mark" className="w-4 h-4" />

export type IconName =
  | "x-mark"
  | "arrow-uturn-left"
  | "arrow-left"
  | "chevron-left"
  | "chevron-right"
  | "chevron-double-left"
  | "chevron-double-right"
  | "play"
  | "pause"
  | "rectangle-stack"
  | "trash"
  | "hand-raised";

interface IconProps {
  name: IconName;
  className?: string;
}

export default function Icon({ name, className = "w-4 h-4" }: IconProps) {
  const outline = (path: string) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );

  switch (name) {
    case "x-mark":
      return outline("M6 18 18 6M6 6l12 12");

    case "arrow-uturn-left":
      return outline("M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3");

    case "arrow-left":
      return outline("M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18");

    case "chevron-left":
      return outline("M15.75 19.5 8.25 12l7.5-7.5");

    case "chevron-right":
      return outline("M8.25 4.5l7.5 7.5-7.5 7.5");

    case "chevron-double-left":
      return outline("M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5");

    case "chevron-double-right":
      return outline("M5.25 4.5l7.5 7.5-7.5 7.5m6-15l7.5 7.5-7.5 7.5");

    case "play":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" />
        </svg>
      );

    case "pause":
      return outline("M15.75 5.25v13.5m-7.5-13.5v13.5");

    case "rectangle-stack":
      // Two offset rectangles suggesting a card stack
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4h9v12H9z M5 8h9v12H5z" />
        </svg>
      );

    case "hand-raised":
      return outline("M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 1 .198-.471 1.575 1.575 0 1 0-2.228-2.228 3.818 3.818 0 0 0-1.12 2.687M6.9 7.575V12m6.27 4.22A2.25 2.25 0 0 1 15 18h.008");

    case "trash":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
      );
  }
}
