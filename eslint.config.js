import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  { ignores: ['dist', 'node_modules', 'data'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      // Price facts have exactly one source and it is not the model.
      // src/pipeline/extract/** must never import the price layer.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/prices/*'],
          message: 'Price facts are computed in src/pipeline/prices/ only. The extraction lane must never produce ytd/mtd/yoy.',
        }],
      }],
    },
  },
  {
    // The rule above is scoped to the extraction lane; everything else may
    // legitimately read the price layer.
    files: ['src/pipeline/prices/**/*.ts', 'src/pipeline/render/**/*.ts', 'src/pipeline/rebuild.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
])
