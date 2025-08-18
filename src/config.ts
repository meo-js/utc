import { glob } from '@meojs/cfgs';
import { loadConfig, type ResolvableConfig } from 'c12';
import { cwd } from 'process';
import type { Argv } from './cli.js';

const { cssExt, htmlExt, scriptExt, vueExt, testSuffix } = glob;

export const CFG_NAME = 'utc';

export interface Config {
  /**
   * Project path.
   *
   * @default {@link cwd}
   */
  project?: string;

  /**
   * JavaScript、HTML、CSS configuration.
   */
  web?: WebConfig;
}

export interface WebConfig {
  /**
   * Source code paths.
   *
   * Support files, directorys, Glob patterns.
   *
   * 如果传入目录，将规范化成带有扩展名的 Glob pattern（`dir/**\/*.<ext>`）：
   * - `JavaScript` - {@link scriptExt}
   * - `CSS` - {@link cssExt}
   * - `HTML` - {@link htmlExt}
   * - `Vue` - {@link vueExt}
   * - `Test` - {@link testSuffix}
   *
   * @default "src"
   */
  source?: string[];

  /**
   * 构建配置。
   */
  build?: WebBuildConfig;

  /**
   * 测试配置。
   */
  test?: WebTestConfig;

  /**
   * Use CSS.
   *
   * @default false
   */
  css?: boolean;

  /**
   * Use Tailwind CSS.
   *
   * @default false
   */
  tailwindcss?: boolean;

  /**
   * JSDoc 检查级别。
   *
   * - none - 不启用 JSDoc 规则
   * - loose - 宽松检查
   * - strict - 严格检查
   *
   * @default "loose"
   */
  jsdoc?: 'none' | 'loose' | 'strict';
}

export interface WebBuildConfig {
  /**
   * 构建入口点。
   *
   * 如果提供该选项，那么将该选项提供的所有模块视为根模块，而不会根据注释自动推断。
   *
   * 支持文件与 Glob patterns。
   *
   * @default 默认自动推断。
   */
  entry?: string | string[];

  /**
   * 构建 `bin` 字段入口点的配置。
   */
  bin?: WebBuildBinConfig;

  /**
   * 严格模式
   *
   * 开启以下检查：
   * - `publint`
   * - `arethetypeswrong`
   * - `knip`(todo)
   *
   * @default false
   */
  strict?: boolean;

  /**
   * 条件构建组。
   */
  conditions?: string[] | Record<string, string[]>;

  /**
   * 条件编译常量类型文件（.d.ts）路径。
   *
   * @default "src/compile-constant.d.ts"
   */
  compileConstantDts?: string;

  /**
   * 自动更新 package.json 的 `exports` 字段。
   *
   * @default true
   */
  exports?: boolean;

  /**
   * 更新 `exports` 字段时生成 `types` 子路径。
   *
   * @default false
   */
  exportTypes?: boolean;
}

export interface WebBuildBinConfig {
  /**
   * 构建时激活的条件
   *
   * @default 构建工具内部的默认值。
   */
  activeConditions?: string[] | Record<string, string>;
}

export interface WebTestConfig {
  /**
   * 排除文件。
   *
   * 支持文件与 Glob patterns。
   *
   * @default "node_modules", ".git", "dist"。
   */
  exclude?: string[];
}

export type ResolvedConfig = Config & {
  project: string;
  web: WebConfig & {
    source: string[];
    build: WebBuildConfig
      & Required<
        Pick<
          WebBuildConfig,
          'strict' | 'compileConstantDts' | 'exports' | 'exportTypes'
        >
      >;
    test: WebTestConfig & Required<Pick<WebTestConfig, 'exclude'>>;
    css: boolean;
    tailwindcss: boolean;
    jsdoc: 'none' | 'loose' | 'strict';
  };
};

export async function resolveConfigFromArgv(cmdArgv: Argv) {
  const argvConfig = parseArgvToConfig(cmdArgv);
  return resolveConfig(cmdArgv.project, argvConfig);
}

export async function resolveConfig(
  project: string = cwd(),
  overrides?: ResolvableConfig<Config>,
) {
  const { config } = await loadConfig({
    cwd: project,
    name: CFG_NAME,
    packageJson: true,
    overrides: overrides,
    defaults: {
      project: cwd(),
      web: {
        source: [`src`],
        css: false,
        tailwindcss: false,
        jsdoc: 'loose',
        build: {
          strict: false,
          compileConstantDts: 'src/compile-constant.d.ts',
          exports: true,
          exportTypes: false,
        },
        test: {
          exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        },
      },
    },
  });

  return config as ResolvedConfig;
}

export async function hasConfig(project: string = cwd()) {
  try {
    await loadConfig({
      cwd: project,
      name: CFG_NAME,
      packageJson: true,
      configFileRequired: true,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function parseArgvToConfig(argv: Argv): Config {
  const config: Config = {};

  const temp: Argv = { ...argv };

  ['_', '$0'].forEach(key => {
    delete temp[key];
  });

  for (const [key, value] of Object.entries(temp)) {
    let parsedValue = value;

    if (key === 'web.build.conditions' && typeof value === 'string') {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        throw new Error(`Invalid JSON for conditions: ${value}`);
      }
    }

    if (key.includes('.')) {
      const nestedKey = key.split('.');
      let current = config;
      for (const [i, part] of nestedKey.entries()) {
        if (i === nestedKey.length - 1) {
          current[part as never] = parsedValue as never;
        } else {
          if (!current[part as never]) {
            current[part as never] = {} as never;
          }
          current = current[part as never];
        }
      }
    } else {
      config[key as never] = parsedValue as never;
    }
  }

  return config;
}
