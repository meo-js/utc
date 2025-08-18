export default {
  'name': '@meojs/cfgs',
  'version': '2.0.37',
  'engines': {
    'node': '>=20',
  },
  'description': "Meo's development configurations.",
  'author': {
    'name': 'SmallMain',
    'email': 'smallmain@outlook.com',
    'url': 'https://www.smallmain.com/',
  },
  'homepage': 'https://www.smallmain.com/',
  'repository': 'github:meo-js/cfgs',
  'bugs': 'https://github.com/meo-js/cfgs/issues',
  'license': 'MIT',
  'publishConfig': {
    'access': 'public',
  },
  'main': 'index.js',
  'types': './types/index.d.ts',
  'type': 'module',
  'peerDependencies': {
    'postcss-html': '^1.8.0',
    'prettier-plugin-organize-imports': '^4.2.0',
    'prettier-plugin-tailwindcss': '^0.6.14',
    'stylelint-config-html': '^1.1.0',
    'stylelint-config-recess-order': '^7.2.0',
    'stylelint-config-standard': '^39.0.0',
    'stylelint-order': '^7.0.0',
    'typescript': '^5.8.3',
  },
  'peerDependenciesMeta': {
    'prettier-plugin-organize-imports': {
      'optional': true,
    },
    'prettier-plugin-tailwindcss': {
      'optional': true,
    },
    'stylelint-config-standard': {
      'optional': true,
    },
    'stylelint-config-recess-order': {
      'optional': true,
    },
    'stylelint-order': {
      'optional': true,
    },
    'postcss-html': {
      'optional': true,
    },
    'stylelint-config-html': {
      'optional': true,
    },
    'typescript': {
      'optional': true,
    },
  },
  'dependencies': {
    '@eslint-community/eslint-plugin-eslint-comments': '^4.5.0',
    '@eslint/compat': '^1.3.2',
    '@eslint/js': '^9.33.0',
    '@html-eslint/eslint-plugin': '^0.44.0',
    '@html-eslint/parser': '^0.44.0',
    'eslint': '^9.33.0',
    'eslint-plugin-depend': '^1.2.0',
    'eslint-plugin-html': '^8.1.3',
    'eslint-plugin-jsdoc': '^52.0.4',
    'eslint-plugin-n': '^17.21.3',
    'eslint-plugin-security': '^3.0.1',
    '@vitest/eslint-plugin': '^1.3.4',
    'jsonc-eslint-parser': '^2.4.0',
    'prettier': '^3.6.2',
    'stylelint': '^16.23.1',
    'typescript-eslint': '^8.39.0',
  },
  'devDependencies': {
    '@types/node': '^20',
    'rimraf': '^6.0.1',
  },
  'scripts': {
    'build':
      'rimraf ./types && npx tsc index.js --declaration --emitDeclarationOnly --allowJs --lib dom,esnext --skipLibCheck --outDir ./types',
    'dev': 'pnpm run build --watch',
    'eslint:inspect': 'pnpx @eslint/config-inspector --config ./eslint.test.js',
    'publish:patch': 'pnpm version patch && pnpm publish',
    'publish:minor': 'pnpm version minor && pnpm publish',
    'publish:major': 'pnpm version major && pnpm publish',
  },
};
