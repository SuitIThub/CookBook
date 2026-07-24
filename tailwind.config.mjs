/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Material Design inspired color palette
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316', // Orange 500
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [
    function ({ addVariant }) {
      // Layout modes — keep in sync with src/lib/layoutMode.ts
      // mobile: tall portrait AND phone-sized short side (width < 600 in tall mode)
      // tablet/desktop: everything else (incl. Fold main ~0.9 aspect)
      addVariant('mobile', '@media (aspect-ratio <= 3/4) and (width < 600px)');
      // not-mobile = (aspect > 3/4) OR (width >= 600)
      addVariant('not-mobile', '@media (aspect-ratio > 3/4), (width >= 600px)');
      // tablet = not-mobile AND width < 1280
      addVariant(
        'tablet',
        '@media (aspect-ratio > 3/4) and (width < 1280px), (width >= 600px) and (width < 1280px)'
      );
      addVariant('desktop', '@media (width >= 1280px)');
    },
  ],
}
