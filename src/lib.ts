import { eslint, glob, prettier, stylelint } from '@meojs/cfgs';
import { resolveWorkspace } from '@meojs/pkg-utils';
import { defu } from 'defu';
import { braceExpand } from 'minimatch';
import { normalize, resolve } from 'path';
import type { TestProjectConfiguration, ViteUserConfig } from 'vitest/config';
import {
  hasConfig,
  resolveConfig,
  type Config,
  type ResolvedConfig,
} from './config.js';
import { compileConstant } from './plugins/compile-constant.js';
import {
  buildResolveConfig,
  initializeActiveConditions,
  normalizeGlob,
} from './shared.js';
const { vueExt, scriptExt } = glob;

export async function config(
  type: 'prettier',
): Promise<ReturnType<typeof prettier.config>>;
export async function config(
  type: 'eslint',
): Promise<ReturnType<typeof eslint.config>>;
export async function config(
  type: 'stylelint',
): Promise<ReturnType<typeof stylelint.config>>;
export async function config(type: 'vitest'): Promise<ViteUserConfig>;
export async function config(opts?: Config): Promise<Config>;
export async function config(
  arg1?: 'prettier' | 'eslint' | 'stylelint' | 'vitest' | Config,
): Promise<unknown> {
  if (arg1 === 'prettier') {
    const {
      web: { tailwindcss },
    } = await resolveConfig();
    return prettier.config({ tailwindcss });
  } else if (arg1 === 'eslint') {
    const {
      web: { jsdoc },
    } = await resolveConfig();
    return eslint.config({ jsdoc });
  } else if (arg1 === 'stylelint') {
    return stylelint.config();
  } else if (arg1 === 'vitest') {
    const config = await resolveConfig();
    return toVitestConfig(config, false);
  } else {
    return arg1;
  }
}

async function toVitestConfig(
  config: ResolvedConfig,
  isProject: boolean,
): Promise<ViteUserConfig> {
  const vitest = await import('vitest/config');
  const {
    project,
    web: {
      test,
      source,
      css,
      platform,
      activeConditions,
      build: { conditions },
    },
  } = config;

  const _activeConditions = initializeActiveConditions(activeConditions);
  const resolveCfg = buildResolveConfig(_activeConditions);

  let projects: TestProjectConfiguration[] | undefined = undefined;
  try {
    const workspace = await resolveWorkspace(project);

    // FIXME: (与下面的代码无关) vitest 暂不支持嵌套 projects https://github.com/vitest-dev/vitest/discussions/7732
    if (normalize(resolve(workspace.rootDir)) === normalize(resolve(project))) {
      projects = [];
      for (const packagePath of workspace.packages) {
        const project = vitest.defineProject({
          test: {
            root: packagePath,
          },
        });

        if (await hasConfig(packagePath, false)) {
          const config = await resolveConfig(packagePath);
          projects.push({
            extends: true,
            ...defu(project, await toVitestConfig(config, true)),
          });
        } else {
          projects.push({
            extends: true,
            ...project,
          });
        }
      }
    }
  } catch (error) {}

  const sharedOptions = vitest.defineProject({
    resolve: {
      extensions: resolveCfg.extensions,
      // vite doesn't have extensionAlias
      conditions: resolveCfg.conditionNames ?? [],
    },
    build: {
      target: 'esnext',
      sourcemap: true,
    },
    esbuild: { platform },
    plugins: [compileConstant(conditions, _activeConditions).vite()],
    test: {
      includeSource: source,
      exclude: test.exclude,
      benchmark: {
        includeSource: source,
      },
      typecheck: {
        enabled: true,
      },
      expect: {
        requireAssertions: true,
      },
      css,
    },
  });

  let options = isProject
    ? vitest.defineProject(sharedOptions)
    : vitest.defineConfig(
        defu(
          sharedOptions,
          vitest.defineConfig({
            test: {
              projects,
              coverage: {
                enabled: true,
                include: await normalizeGlob(
                  source,
                  `{${[scriptExt, vueExt].flatMap(v => braceExpand(v)).join(',')}}`,
                  project,
                ),
              },
            },
          }),
        ),
      );

  if (test.vitest) {
    if (typeof test.vitest === 'function') {
      options = await test.vitest(options);
    } else {
      options = defu(options, test.vitest);
    }
  }

  return options;
}
