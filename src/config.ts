import { glob } from '@meojs/cfgs';
import { resolveWorkspace } from '@meojs/pkg-utils';
import { loadConfig, type LoadConfigOptions, type ResolvableConfig } from 'c12';
import { cwd } from 'process';
import type { Options as TsdownOptions } from 'tsdown';
import type { ViteUserConfig } from 'vitest/config';
import type { Argv } from './cli.js';
import { conditionsToPlatform } from './shared.js';

const { cssExt, htmlExt, scriptExt, vueExt, testSuffix } = glob;

export const CFG_NAME = 'utc';

export interface Config {
  /**
   * 从其他配置继承。
   */
  extends?: string | string[];

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
   * 开发时的平台；构建时的默认平台。
   *
   * @default 如果提供了 {@link activeConditions} 且存在 `node` 或 `browser` 条件，
   *          则自动根据条件推断，若不存在或这两个条件都存在，则默认为 `neutral`。
   */
  platform?: 'node' | 'browser' | 'neutral';

  /**
   * 开发时激活的额外条件。
   *
   * @default 如果提供了 {@link platform} 则自动推断。
   */
  activeConditions?: string[] | Record<string, string>;

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

  /**
   * tsdown 配置。
   */
  tsdown?: TsdownOptions | ((options: TsdownOptions) => Promise<TsdownOptions>);
}

export interface WebBuildBinConfig {
  /**
   * 构建平台。
   *
   * @default "node"
   */
  platform?: 'node' | 'browser' | 'neutral';

  /**
   * 构建时激活的额外条件
   *
   * @default 根据 {@link platform} 自动推断。
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

  /**
   * vitest 配置。
   */
  vitest?:
    | ViteUserConfig
    | ((options: ViteUserConfig) => Promise<ViteUserConfig>);
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
      > & {
        bin: WebBuildBinConfig & Required<Pick<WebBuildBinConfig, 'platform'>>;
      };
    platform: 'node' | 'browser' | 'neutral';
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

const BASE_OPTIONS: LoadConfigOptions<Config> = {
  name: CFG_NAME,
  packageJson: true,
};

export async function resolveConfig(
  project: string = cwd(),
  overrides?: ResolvableConfig<Config>,
) {
  const options: LoadConfigOptions<Config> = {
    ...BASE_OPTIONS,
    overrides: overrides,
    defaults: {
      project,
      web: {
        source: [`src`],
        css: false,
        tailwindcss: false,
        jsdoc: 'loose',
        build: {
          strict: true,
          compileConstantDts: 'src/compile-constant.d.ts',
          exports: true,
          exportTypes: false,
          bin: {},
        },
        test: {
          exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        },
      },
    },
  };

  let { config, _configFile } = await loadConfig({
    ...options,
    cwd: project,
  });

  if (_configFile == null) {
    try {
      const workspace = await resolveWorkspace(project);
      const { config: _config } = await loadConfig({
        ...options,
        cwd: workspace.rootDir,
      });
      config = _config;
    } catch (error) {}
  }

  config = resolvePlatformConditions(config as ResolvedConfig);

  return config as ResolvedConfig;
}

export async function hasConfig(
  project: string = cwd(),
  includeWorkspace: boolean,
) {
  const { _configFile } = await loadConfig({
    ...BASE_OPTIONS,
    cwd: project,
  });

  if (_configFile) {
    if (includeWorkspace) {
      const workspace = await resolveWorkspace(project);
      const { _configFile } = await loadConfig({
        ...BASE_OPTIONS,
        cwd: workspace.rootDir,
      });
      return _configFile != null;
    } else {
      return false;
    }
  }

  return true;
}

function resolvePlatformConditions(config: ResolvedConfig): ResolvedConfig {
  const { web } = config;
  let {
    activeConditions,
    platform,
    build: {
      bin: {
        activeConditions: binActiveConditions,
        platform: binPlatform,
      } = {},
    } = {},
  } = web;

  let result = _resolvePlatformConditions(platform, activeConditions);
  web.activeConditions = result.activeConditions;
  web.platform = result.platform;

  binPlatform ??= 'node';
  result = _resolvePlatformConditions(binPlatform, binActiveConditions);
  web.build.bin.activeConditions = result.activeConditions;
  web.build.bin.platform = result.platform;

  return config;
}

function _resolvePlatformConditions(
  platform?: 'node' | 'browser' | 'neutral',
  activeConditions?: string[] | Record<string, string>,
): {
  platform: 'node' | 'browser' | 'neutral';
  activeConditions?: string[] | Record<string, string>;
} {
  if (activeConditions && platform) {
    return { platform, activeConditions };
  }

  if (platform) {
    return {
      platform,
      activeConditions: platform === 'neutral' ? undefined : [platform],
    };
  }

  const conditions = [];

  if (Array.isArray(activeConditions)) {
    conditions.push(...activeConditions);
  } else if (typeof activeConditions === 'object') {
    conditions.push(...Object.values(activeConditions));
  }

  return {
    platform: conditionsToPlatform(conditions, 'neutral'),
    activeConditions,
  };
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
