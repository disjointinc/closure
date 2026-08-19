import base from "../eslint.config.mjs";

export default [
  ...base,
  {
    ignores: ["dist/", "routeTree.gen.ts"],
  },
];
