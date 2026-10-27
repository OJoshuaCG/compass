/** Reglas que ESLint no cubre bien: fachadas entre módulos y ciclos (docs/backend.md §3.2, §3.5). */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Un ciclo de importación indica módulos mal separados: usa un evento o mueve la responsabilidad.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'modules-only-through-facade',
      severity: 'error',
      comment:
        'Un módulo solo importa a otro por su fachada pública (modules/<otro>/index.ts), nunca por repositorios, entidades o tablas.',
      from: { path: '^src/modules/([^/]+)/', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'shared-does-not-know-modules',
      severity: 'error',
      comment: 'shared/ es transversal: no puede depender de ningún módulo de dominio.',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'El código de producción no importa dependencias de desarrollo.',
      from: { path: '^src/', pathNot: '\\.test\\.ts$|/testing/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    tsPreCompilationDeps: true,
    moduleSystems: ['es6'],
  },
};
