import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Config mínima pero con lo que importa: detectar en el momento de compilar los
// errores que hoy solo aparecen cuando el usuario abre la pantalla y la app se
// queda en blanco — nombres sin importar y variables usadas antes de definirse.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**', 'scripts/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      // Los tres bugs de pantalla en blanco que tuvimos caen acá:
      'no-undef': 'error',              // usar algo que no se importó
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
      'react/jsx-uses-vars': 'error',   // no marcar como sin usar lo que sí se usa en JSX
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]
