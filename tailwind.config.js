/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // All colors resolve to CSS variables — shared token system for both themes.
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        text: {
          DEFAULT: "var(--text)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          disabled: "var(--text-disabled)",
          onAccent: "var(--text-on-accent)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          2: "var(--accent-2)",
          soft: "var(--accent-soft)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Manrope",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      fontSize: {
        // 4px-grid type scale
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      },
      borderRadius: {
        xs: "0.25rem",
        sm: "0.375rem",
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        pop: "var(--shadow-pop)",
        glow: "var(--shadow-glow)",
        "glow-accent": "var(--shadow-glow-accent)",
        inset: "var(--shadow-inset)",
      },
      spacing: {
        // micro-steps allowed inside small controls only (unslop: 2px for nudges)
        0.5: "0.125rem",
        1.5: "0.375rem",
        4.5: "1.125rem",
        18: "4.5rem",
        22: "5.5rem",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        indeterminate: {
          "0%": { left: "-40%", width: "40%" },
          "100%": { left: "100%", width: "40%" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "scale-in": "scale-in 0.16s cubic-bezier(0.2, 0.8, 0.3, 1)",
        "slide-up": "slide-up 0.22s cubic-bezier(0.2, 0.8, 0.3, 1)",
        shimmer: "shimmer 1.4s linear infinite",
        indeterminate: "indeterminate 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
