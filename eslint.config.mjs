import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // front-desk-brain 6.1: the Code_Brain is pure. It can never reach the model or the database.
  {
    files: ["lib/conversation/brain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db", "@/lib/db/*", "**/lib/db", "**/lib/db/*", "../../db", "../../db/*"],
              message: "The Code_Brain is pure: no database access (front-desk-brain design.md, Modules).",
            },
            {
              group: ["@/lib/receptionist/callModel", "**/receptionist/callModel", "**/callModel"],
              message: "The Code_Brain never calls the model (front-desk-brain design.md, Modules).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway spikes and measurement output; gitignored, never part of the app.
    ".measurements/**",
  ]),
]);

export default eslintConfig;
