import base from "../eslint.config.mjs";

export default [
  ...base,
  {
    ignores: ["dist/", "src/routeTree.gen.ts"],
  },
];
