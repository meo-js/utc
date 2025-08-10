import { loadConfig, type ResolvableConfig } from 'c12';
import { cwd } from 'process';
import type { Argv } from './cli.js';
import { scriptExt } from './shared.js';

export const CFG_NAME = 'utc';

export interface Config {
    /**
     * Project path.
     *
     * @default {@link cwd}
     */
    project?: string;

    /**
     * JavaScript configuration.
     */
    js?: JsConfig;
}

export interface JsConfig {
    /**
     * Source code paths.
     *
     * Support files, directorys, Glob patterns.
     *
     * @default "src/**\/*.{@link scriptExt}"
     */
    source?: string[];

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
    js: JsConfig & {
        source: string[];
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
            js: {
                source: [`src/**/*.${scriptExt}`],
                tailwindcss: false,
                jsdoc: 'loose',
            },
        },
    });

    return config as ResolvedConfig;
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
