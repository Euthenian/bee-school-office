import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "data/legacy/taiken-audit/**"]
  },
  ...nextVitals
];

export default eslintConfig;
