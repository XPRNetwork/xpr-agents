const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist)', ...defaultTheme.fontFamily.sans],
        display: ['var(--font-instrument)', 'var(--font-geist)', ...defaultTheme.fontFamily.sans],
        mono: ['var(--font-geist-mono)', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        // Semantic tokens — light, institutional. Use these, not raw zinc-*.
        canvas: '#FFFFFF',
        surface: { DEFAULT: '#F6F7FA', 2: '#EDEFF4' },
        line: { DEFAULT: '#E2E5EC', 2: '#C9CED9' },
        ink: { DEFAULT: '#0C0E14', 2: '#4B5263' },
        muted: '#6F7789',
        accent: { DEFAULT: '#4B3ADF', hover: '#3A2CB8', soft: '#EEEBFD' },
        good: { DEFAULT: '#0F7B4C', soft: '#E6F5EE' },
        warn: { DEFAULT: '#A65B00', soft: '#FBF1E2' },
        crit: { DEFAULT: '#B42318', soft: '#FCEBE9' },
        // Legacy alias kept so any missed class still resolves to the accent.
        proton: {
          purple: '#4B3ADF',
          dark: '#0C0E14',
          light: '#F6F7FA',
        },
      },
      letterSpacing: {
        display: '-0.025em',
        label: '0.06em',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-bottom': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.9)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(1.5)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'gradient-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        skeleton: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'ring-fill': {
          from: { strokeDashoffset: 'var(--ring-circumference)' },
          to: { strokeDashoffset: 'var(--ring-offset)' },
        },
        'bar-fill': {
          from: { width: '0%' },
          to: { width: 'var(--bar-width)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
        'slide-in-left': 'slide-in-left 0.5s ease-out forwards',
        'slide-in-bottom': 'slide-in-bottom 0.6s ease-out forwards',
        'scale-in': 'scale-in 0.4s ease-out forwards',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        skeleton: 'skeleton 1.5s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'ring-fill': 'ring-fill 1s ease-out forwards',
        'bar-fill': 'bar-fill 0.8s ease-out forwards',
      },
    },
  },
  plugins: [],
};
