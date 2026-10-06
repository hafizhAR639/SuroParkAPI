/** Dependency-cruiser validation (TRD §18.3): circular deps + forbidden cross-layer edges. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-no-framework',
      comment: 'domain must not import infrastructure/interfaces/frameworks',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/(infrastructure|interfaces)' },
    },
    {
      name: 'usecases-no-outer',
      comment: 'usecases must not import infrastructure/interfaces',
      severity: 'error',
      from: { path: '^src/usecases' },
      to: { path: '^src/(infrastructure|interfaces)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
