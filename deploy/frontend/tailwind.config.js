/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        xpr: {
          purple: '#7B2FBE',
          dark: '#0D0B1A',
          card: '#1A1730',
          border: '#2A2545',
        },
      },
    },
  },
  plugins: [],
};
