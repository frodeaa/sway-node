import globals from 'globals';
export default [
  {
    ignores: ['**/dist/*.js', 'coverage/**/*', 'node_modules/**/*'],
  },
  {
    files: ['**/*.js'],
    rules: {
      'array-bracket-spacing': [2, 'never'],
      'brace-style': [2, '1tbs'],
      'comma-style': [2, 'last'],
      'computed-property-spacing': [2, 'never'],
      curly: [2, 'multi-line'],
      'default-case': 2,
      'func-style': [2, 'declaration'],
      'guard-for-in': 2,
      'newline-after-var': 2,
      'no-floating-decimal': 2,
      'no-inner-declarations': [2, 'both'],
      'no-multiple-empty-lines': 2,
      'no-nested-ternary': 2,
      'no-path-concat': 2,
      'no-undef': 2,
      'object-curly-spacing': [2, 'never'],
      quotes: [2, 'single', 'avoid-escape'],
      radix: 2,
      'keyword-spacing': [2, {after: true}],
      'space-before-blocks': [2, 'always'],
      'space-before-function-paren': [2, 'always'],
      'space-in-parens': [2, 'never'],
      'spaced-comment': [2, 'always'],
      strict: [2, 'global'],
      'wrap-iife': 2,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.mocha,
        ...globals.node,
      },
    },
  },
  {
    ignores: ["test/**/*.js"],
    rules: {
      'no-unused-vars': 2,
    },
  }
];
