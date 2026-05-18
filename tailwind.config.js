export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        campo: {
          50: '#eef8f1',
          100: '#d6efdc',
          500: '#1f8a4c',
          600: '#1f6f45',
          700: '#1d593a',
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
