import { eslint, glob, prettier, stylelint } from '@meojs/cfgs';
import { braceExpand } from 'minimatch';
import { cwd } from 'process';
import * as vitest from 'vitest/config';
import { buildResolveConfig } from './commands/build.js';
import { resolveConfig, type Config } from './config.js';
import { compileConstant } from './plugins/compile-constant.js';
import { normalizeGlob } from './shared.js';

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
export async function config(type: 'vitest'): Promise<vitest.ViteUserConfig>;
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
    const {
      web: {
        test,
        source,
        css,
        build: { conditions },
      },
    } = await resolveConfig();
    const activeConditions = {};
    const resolve = buildResolveConfig(activeConditions);
    return vitest.defineConfig({
      resolve: {
        extensions: resolve.extensions,
        // vite doesn't have extensionAlias
        conditions: resolve.conditionNames ?? [],
      },
      build: {
        target: 'esnext',
        sourcemap: true,
      },
      esbuild: { platform: 'neutral' },
      plugins: [compileConstant(conditions, activeConditions).vite()],
      test: {
        includeSource: source,
        exclude: test.exclude,
        benchmark: {
          includeSource: source,
        },
        coverage: {
          enabled: true,
          include: await normalizeGlob(
            source,
            `{${[scriptExt, vueExt].flatMap(v => braceExpand(v)).join(',')}}`,
            cwd(),
          ),
        },
        typecheck: {
          enabled: true,
        },
        css,
      },
    });
  } else {
    return arg1;
  }
}
