/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          amber: "#f59e0b",
          amethyst: "#a855f7",
          emerald: "#10b981",
          ruby: "#ef4444",
          sapphire: "#3b82f6",
          steel: "#94a3b8",
        },
      },
      screens: {
        // Custom: phone in landscape orientation (short viewport). Declared
        // via `extend` so it appends AFTER lg in Tailwind's default cascade,
        // letting landscape-phone: utilities win over md:/lg: at the same
        // specificity. Tablets in landscape are 768px+ tall so they keep the
        // existing md:/lg: sidebar layout.
        "landscape-phone": { raw: "(orientation: landscape) and (max-height: 500px)" },
      },
    },
  },
  plugins: [],
};
