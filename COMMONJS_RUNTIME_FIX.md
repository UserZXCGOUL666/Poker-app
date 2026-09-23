# Vercel runtime module fix

This variant makes the API runtime explicit CommonJS so the deployed `/var/task/src/app.js` does not depend on a copied `package.json` to be interpreted correctly.

Changes:
- removed root `type: module`;
- set `apps/api/package.json` to `type: commonjs`;
- set API TypeScript output to CommonJS;
- changed Express app export to `module.exports`;
- changed local API entry files to `require`;
- removed manual `tsc` from the Vercel build hook; Vercel transpiles the Express entrypoint itself. Prisma generate/migrate remains in the hook.
