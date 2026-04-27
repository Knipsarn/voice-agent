/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0a",
        paper: "#fcfcfd",
        surface: "#ffffff",
        muted: "#71717a",
        subtle: "#a1a1aa",
        line: "#e4e4e7",
        "line-soft": "#f4f4f5",
        accent: {
          DEFAULT: "#5b5bd6",
          hover: "#4848b8",
          soft: "#f0f0fe",
        },
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "'Inter'", "'Segoe UI'", "Roboto", "sans-serif"],
        display: ["-apple-system", "'Inter'", "sans-serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(15, 23, 42, 0.04)",
        elevated: "0 8px 32px -12px rgba(15, 23, 42, 0.12), 0 2px 4px -1px rgba(15, 23, 42, 0.04)",
        focus: "0 0 0 3px rgba(91, 91, 214, 0.18)",
      },
      backgroundImage: {
        "grid-pattern": "linear-gradient(rgba(228, 228, 231, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(228, 228, 231, 0.5) 1px, transparent 1px)",
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "slide-in-right": "slide-in-right 0.2s ease-out",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
