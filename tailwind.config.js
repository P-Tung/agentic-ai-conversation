/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gray: {
          950: '#030712',
        }
      }
    },
  },
  plugins: [],
  safelist: [
    'sessions-grid-1',
    'sessions-grid-2',
    'sessions-grid-3',
    'sessions-grid-4',
    'sessions-grid-5',
    'sessions-grid-6',
  ]
}
