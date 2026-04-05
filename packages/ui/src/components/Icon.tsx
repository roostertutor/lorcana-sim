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
  | "hand-raised"
  // Keyword ability icons
  | "shield-check"
  | "arrow-up"
  | "exclamation-triangle"
  | "lock-closed"
  | "bolt"
  | "arrow-right"
  | "musical-note"
  | "user-plus"
  | "minus-circle"
  | "magnifying-glass";

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

    // Keyword ability icons
    case "shield-check":
      return outline("M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z");

    case "arrow-up":
      return outline("M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18");

    case "exclamation-triangle":
      return outline("M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z");

    case "lock-closed":
      return outline("M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z");

    case "bolt":
      return outline("m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z");

    case "arrow-right":
      return outline("M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3");

    case "musical-note":
      return outline("M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3");

    case "user-plus":
      return outline("M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z");

    case "minus-circle":
      return outline("M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z");

    case "magnifying-glass":
      return outline("m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z");
  }
}
