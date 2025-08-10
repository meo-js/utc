import { eslint, prettier } from '@meojs/cfgs';
import type { Config } from './config.js';

export function config(type: 'prettier'): ReturnType<typeof prettier.config>;
export function config(type: 'eslint'): ReturnType<typeof eslint.config>;
export function config(opts?: Config): Config;
export function config(arg1?: 'prettier' | 'eslint' | Config): unknown {
    if (arg1 === 'prettier') {
        return prettier.config();
    } else if (arg1 === 'eslint') {
        return eslint.config();
    } else {
        return arg1;
    }
}
