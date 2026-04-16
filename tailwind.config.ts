import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#08111f",
        mist: "#eef3f8",
        accent: "#0f766e",
        coral: "#fb7185",
        gold: "#f59e0b"
      },
      boxShadow: {
        panel: "0 16px 40px rgba(8, 17, 31, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
