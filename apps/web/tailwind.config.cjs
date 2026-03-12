/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#2C2925',
        paper: '#F4F1EA',
        stock: '#EBE7DE',
        pencil: '#8C8781',
        'seal-red': '#9E3E36',
        'binding-blue': '#3A5A6D',
        'border-pencil': '#D6D1C9',
      },
      fontFamily: {
        serif: ['Piazzolla', 'serif'],
        body: ['EB Garamond', 'serif'],
        sans: ['Libre Franklin', 'sans-serif'],
      },
      backgroundImage: {
        noise:
          "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22 opacity=%220.04%22/%3E%3C/svg%3E')",
      },
    },
  },
  plugins: [],
};
