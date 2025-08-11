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

export type ResolvedConfig = Config & {
    project: string;
    web: WebConfig & {
        source: string[];
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
        if (key.includes('.')) {
            const nestedKey = key.split('.');
            let current = config;
            for (const [i, part] of nestedKey.entries()) {
                if (i === nestedKey.length - 1) {
                    current[part as never] = value as never;
                } else {
                    if (!current[part as never]) {
                        current[part as never] = {} as never;
                    }
                    current = current[part as never];
                }
            }
        } else {
            config[key as never] = value as never;
        }
    }

    return config;
}
