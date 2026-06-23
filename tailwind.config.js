export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        campo: {
          50: '#eef8f1',
          100: '#d6efdc',
          200: '#b3e0c4',
          300: '#7ac79d',
          400: '#3daa6f',
          500: '#1f8a4c',
          600: '#1f6f45',
          700: '#1d593a',
          800: '#164530',
          900: '#0f3022',
        },
        tierra: '#8a5a32',
        maiz: '#e6b645',
      },
      boxShadow: {
        soft: '0 10px 30px rgba(33, 45, 38, 0.08)',
      },
    },
  },
  plugins: [],
}
