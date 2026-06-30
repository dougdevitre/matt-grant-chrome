// Allow side-effect CSS imports (e.g. `import "./styles.css"`). Newer TypeScript
// flags untyped side-effect imports (TS2882); this declares the module so the
// extension typechecks regardless of the TS version.
declare module "*.css";
