import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  hooks.configs.flat.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  globalIgnores([".next/**", ".local/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"])
]);
