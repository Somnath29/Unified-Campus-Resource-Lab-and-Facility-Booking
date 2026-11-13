/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        lpu: {
          orange: '#F58220',
          'orange-hover': '#E06D0C',
          'orange-light': '#FFF4EA',
          'orange-border': '#FED7AA',
          charcoal: '#292929',
          sidebar: '#161922',
          'sidebar-active': '#F58220',
          'sidebar-hover': '#232733',
          bg: '#F5F5F5',
          card: '#FFFFFF',
          blue: '#1976B9',
          'blue-light': '#EBF5FB',
          green: '#10B981',
          'green-light': '#ECFDF5',
          amber: '#F59E0B',
          'amber-light': '#FFFBEB',
          red: '#EF4444',
          'red-light': '#FEF2F2',
          border: '#E5E7EB',
          muted: '#6B7280',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

