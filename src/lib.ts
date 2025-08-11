import { eslint, prettier, stylelint } from '@meojs/cfgs';
import { resolveConfig, type Config } from './config.js';

export async function config(
    type: 'prettier',
): Promise<ReturnType<typeof prettier.config>>;
export async function config(
    type: 'eslint',
): Promise<ReturnType<typeof eslint.config>>;
export async function config(
    type: 'stylelint',
): Promise<ReturnType<typeof stylelint.config>>;
export async function config(opts?: Config): Promise<Config>;
export async function config(
    arg1?: 'prettier' | 'eslint' | 'stylelint' | Config,
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
    } else {
        return arg1;
    }
}
