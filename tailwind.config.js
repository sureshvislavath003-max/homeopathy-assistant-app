/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}", // Scan all JS/JSX/TS/TSX files in src for Tailwind classes
    "./public/index.html", // Also scan your index.html
  ],
  darkMode: 'class', // Enable dark mode based on 'dark' class on html element
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'], // Define Inter font
        poppins: ['Poppins', 'sans-serif'], // Define Poppins font
      },
      colors: {
        // Define your custom color palette here if needed
        // Example:
        // 'olive-green': '#556B2F',
        // 'soft-pastel-blue': '#B0E0E6',
      }
    },
  },
  plugins: [],
}
