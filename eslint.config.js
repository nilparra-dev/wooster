import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Lints the CLI only; the player has its own configuration in frontend/.
// Type-aware rules are limited to the two that catch real asynchronous bugs
// in a tool built around network requests, signals and child processes.
export default tseslint.config(
  { ignores: ["dist/**", "frontend/**", "node_modules/**", "downloads/**", "docs/**"] },
  {
    files: ["cli/src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: { project: "./tsconfig.cli.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // A shadowed binding silently detaches cleanup code from the state it
      // was written for, as happened with the in-flight segment map.
      "@typescript-eslint/no-shadow": "error",
    },
  },
  {
    files: ["cli/test/**/*.mjs", "scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
);
