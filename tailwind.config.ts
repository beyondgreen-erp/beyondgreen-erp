import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontSize: {
        // Bump every text size up one step for readability across the platform
        'xs':   ['13px',  { lineHeight: '20px' }],   // was 12px
        'sm':   ['15px',  { lineHeight: '24px' }],   // was 14px
        'base': ['16px',  { lineHeight: '26px' }],   // unchanged
        'lg':   ['18px',  { lineHeight: '28px' }],   // was 18px
        'xl':   ['20px',  { lineHeight: '30px' }],   // was 20px
        '2xl':  ['24px',  { lineHeight: '32px' }],
        '3xl':  ['30px',  { lineHeight: '38px' }],
      },
    },
  },
  plugins: [],
};
export default config;
