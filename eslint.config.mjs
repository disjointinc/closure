import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["web/dist/", "web/src/routeTree.gen.ts"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    rules: {
      curly: ["error", "all"],
    },
  },
];
