import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#070b12",
        surface: {
          50: "#182238",
          100: "#141c2e",
          200: "#0f1726",
          300: "#0b111d",
          DEFAULT: "rgba(15, 23, 42, 0.65)",
          glass: "rgba(11, 17, 29, 0.75)",
          card: "rgba(18, 26, 43, 0.6)",
        },
        primary: {
          DEFAULT: "#38bdf8",
          hover: "#0284c7",
          glow: "rgba(56, 189, 248, 0.25)",
        },
        accent: {
          DEFAULT: "#818cf8",
          glow: "rgba(129, 140, 248, 0.25)",
        },
        success: {
          DEFAULT: "#10b981",
          glow: "rgba(16, 185, 129, 0.25)",
        },
        warning: {
          DEFAULT: "#f59e0b",
          glow: "rgba(245, 158, 11, 0.25)",
        },
        danger: {
          DEFAULT: "#f43f5e",
          glow: "rgba(244, 63, 94, 0.25)",
        },
      },
      fontFamily: {
        sans: ["var(--font-outfit)", "Outfit", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        pulseSlow: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(1.08)" },
        },
        equalizer1: {
          "0%, 100%": { height: "4px" },
          "50%": { height: "24px" },
        },
        equalizer2: {
          "0%, 100%": { height: "18px" },
          "50%": { height: "6px" },
        },
        equalizer3: {
          "0%, 100%": { height: "8px" },
          "50%": { height: "28px" },
        },
        equalizer4: {
          "0%, 100%": { height: "22px" },
          "50%": { height: "10px" },
        },
        equalizer5: {
          "0%, 100%": { height: "6px" },
          "50%": { height: "20px" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s infinite",
        "pulse-slow": "pulseSlow 2s ease-in-out infinite",
        "eq-1": "equalizer1 0.8s ease-in-out infinite",
        "eq-2": "equalizer2 0.7s ease-in-out infinite",
        "eq-3": "equalizer3 1.1s ease-in-out infinite",
        "eq-4": "equalizer4 0.9s ease-in-out infinite",
        "eq-5": "equalizer5 0.75s ease-in-out infinite",
        shake: "shake 0.4s ease-in-out",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "glow-cyan": "0 0 25px rgba(56, 189, 248, 0.3)",
        "glow-indigo": "0 0 25px rgba(129, 140, 248, 0.3)",
        "glow-emerald": "0 0 25px rgba(16, 185, 129, 0.3)",
      },
    },
  },
  plugins: [],
};

export default config;
