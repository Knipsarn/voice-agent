/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#f8fafc",
        surface: "#ffffff",
        muted: "#64748b",
        subtle: "#94a3b8",
        line: "#e2e8f0",
        accent: {
          DEFAULT: "#6366f1",
          hover: "#4f46e5",
          soft: "#eef2ff",
        },
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "'Inter'", "'Segoe UI'", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)",
        elevated: "0 4px 24px -8px rgba(15, 23, 42, 0.12), 0 1px 3px 0 rgba(15, 23, 42, 0.06)",
        glow: "0 0 0 4px rgba(99, 102, 241, 0.12)",
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, #eef2ff 0%, #faf5ff 100%)",
        "gradient-accent": "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.25s ease-out",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
