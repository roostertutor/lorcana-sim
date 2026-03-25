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
    },
  },
  plugins: [],
};
