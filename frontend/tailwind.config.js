/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        proton: {
          purple: '#7D3CF8',
          dark: '#1A1A2E',
          light: '#F5F5F7',
        },
      },
    },
  },
  plugins: [],
};
