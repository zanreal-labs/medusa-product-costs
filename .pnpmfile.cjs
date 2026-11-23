// tsup, typescript-eslint and the Medusa eslint plugin load the TypeScript JS API, which TypeScript 7
// does not ship. Swap their typescript peer for the TypeScript 6 compatibility
// package so the rest of the repo can stay on TypeScript 7.
const needsJsApi = (name) => name === "tsup" || name === "@medusajs/eslint-plugin" || name.startsWith("@typescript-eslint/");

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (needsJsApi(pkg.name) && pkg.peerDependencies?.typescript) {
        delete pkg.peerDependencies.typescript;
        delete pkg.peerDependenciesMeta?.typescript;
        pkg.dependencies = {
          ...pkg.dependencies,
          typescript: "npm:@typescript/typescript6@^6.0.2",
        };
      }
      return pkg;
    },
  },
};
