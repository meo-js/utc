import format from '@commitlint/format';
import lint from '@commitlint/lint';
import load from '@commitlint/load';
import { glob as globExt } from '@meojs/cfgs';
import { expand } from 'braces';
import { execSync } from 'child_process';
import { ESLint } from 'eslint';
import { readFile, stat } from 'fs/promises';
import { glob } from 'glob';
import { extname } from 'path';
import * as prettier from 'prettier';
import { exit } from 'process';
import stylelint from 'stylelint';
import { cli } from '../cli.js';
import { resolveConfigFromArgv, type ResolvedConfig } from '../config.js';

const { cssExt, htmlExt, scriptExt, vueExt } = globExt;

cli.command(
    'lint',
    'Check if the code conforms to the team specs.',
    argv => {
        return argv
            .option('staged', {
                describe: 'Check staged files only.',
                type: 'boolean',
                default: false,
            })
            .option('message', {
                alias: 'm',
                describe: 'Check the incoming commit message.',
                type: 'string',
                requiresArg: true,
            });
    },
    async args => {
        console.log(`Linting...`);
        const config = await resolveConfigFromArgv(args);

        if (args.message != null) {
            await lintCommitMessage(args.message);
            return;
        }

        if (args.staged) {
            const stagedFiles = getStagedFiles();

            if (stagedFiles.length === 0) {
                console.log('No staged files found.');
                return;
            }

            const [jsPassed, stylePassed] = await Promise.all([
                lintJsFiles(stagedFiles, config, true),
                lintStyleFiles(stagedFiles, config, true),
            ]);

            if (!(jsPassed && stylePassed)) {
                process.exit(1);
            }

            console.log('All staged files passed linting checks.');
        } else {
            const [jsPassed, stylePassed] = await Promise.all([
                lintJsFiles([], config, false),
                lintStyleFiles([], config, false),
            ]);
            if (!(jsPassed && stylePassed)) {
                process.exit(1);
            }
        }

        console.log('All files passed linting checks.');
    },
);

function getStagedFiles(): string[] {
    try {
        const stagedFiles = execSync('git diff --cached --name-only', {
            encoding: 'utf8',
        })
            .trim()
            .split('\n')
            .filter(file => file.length > 0);

        return stagedFiles;
    } catch (error) {
        console.error('Error getting staged files:', (error as Error).message);
        process.exit(1);
    }
}

async function lintJsFiles(
    stagedFiles: string[],
    config: ResolvedConfig,
    isStaged: boolean,
): Promise<boolean> {
    const exts = expand(scriptExt);

    if (isStaged) {
        const targetFiles = await filterFiles(
            stagedFiles,
            exts,
            config.web.source,
            config.project,
        );

        if (targetFiles.length === 0) {
            console.log('No JavaScript files to lint.');
            return true;
        }

        const [eslintPassed, prettierPassed] = await Promise.all([
            lintWithESLint(targetFiles, config.project),
            lintWithPrettier(targetFiles),
        ]);

        return eslintPassed && prettierPassed;
    } else {
        const [eslintPassed, prettierPassed] = await Promise.all([
            lintWithESLint(
                await normalizeGlob(config.web.source, exts),
                config.project,
            ),
            lintWithPrettier(
                await resolveGlob(config.web.source, config.project, exts),
            ),
        ]);

        return eslintPassed && prettierPassed;
    }
}

async function lintStyleFiles(
    stagedFiles: string[],
    config: ResolvedConfig,
    isStaged: boolean,
): Promise<boolean> {
    if (!config.web.css) {
        return true;
    }

    const exts = [cssExt, htmlExt, vueExt].flatMap(expand);

    try {
        if (isStaged) {
            const targetFiles = await filterFiles(
                stagedFiles,
                exts,
                config.web.source,
                config.project,
            );

            if (targetFiles.length === 0) {
                console.log('No style files to lint.');
                return true;
            }

            return await lintWithStylelint(targetFiles, config.project);
        } else {
            return await lintWithStylelint(
                await normalizeGlob(config.web.source, exts),
                config.project,
            );
        }
    } catch (error) {
        console.error('Stylelint check failed:', (error as Error).message);
        return false;
    }
}

async function filterFiles(
    files: string[],
    exts: string[],
    sourcePatterns: string[],
    projectPath: string,
): Promise<string[]> {
    const allSourceFiles = await resolveGlob(sourcePatterns, projectPath, exts);
    const sourceFilesSet = new Set(
        allSourceFiles.map(file => file.replace(`${projectPath}/`, '')),
    );
    return files.filter(file => sourceFilesSet.has(file));
}

async function resolveGlob(
    patterns: string[],
    projectPath: string,
    exts: string[],
): Promise<string[]> {
    const allFiles: string[] = [];

    for (const pattern of await normalizeGlob(patterns, exts)) {
        const files = await glob(pattern, {
            cwd: projectPath,
            absolute: true,
            nodir: true,
        });
        allFiles.push(...files);
    }

    return [...new Set(allFiles)];
}

async function normalizeGlob(patterns: string[], exts: string[]) {
    // 可能传入目录，且需确保只有特定类型的文件
    const normalized: string[] = [];
    for (const pattern of patterns) {
        const stats = await stat(pattern);
        if (stats.isDirectory()) {
            normalized.push(`${pattern}/**/*.{${exts.join(',')}}`);
        } else {
            expand(pattern).forEach(p => {
                const ext = extname(p).slice(1);
                if (ext === '' && isGlobPattern(p)) {
                    // 如果是 Glob pattern 且没有扩展名，则添加扩展名
                    normalized.push(`${p}.{${exts.join(',')}}`);
                }
                if (exts.includes(ext)) {
                    normalized.push(p);
                }
            });
        }
    }
    return normalized;
}

function isGlobPattern(pattern: string): boolean {
    // 以 ! 开头的否定模式
    if (pattern.startsWith('!')) return true;

    // 匹配未被反斜线转义的通配符：*, ?, [...], {...}, 以及 extglob：!(), +(), ?(), *(), @()
    const globLikeRE =
        /(^|[^\\])(?:[*?]|\[[^\]]+\]|\{[^}]+\}|[!@+?*]\([^)]*\))/;
    return globLikeRE.test(pattern);
}

async function lintWithESLint(
    patterns: string[],
    projectPath: string = process.cwd(),
): Promise<boolean> {
    try {
        const eslint = new ESLint({
            cwd: projectPath,
        });

        const results = await eslint.lintFiles(patterns);
        const formatter = await eslint.loadFormatter('stylish');
        const resultText = formatter.format(results);

        if (resultText) {
            console.log(resultText);
        }

        const hasErrors = results.some(result => result.errorCount > 0);
        return !hasErrors;
    } catch (error) {
        console.error('ESLint check failed:', (error as Error).message);
        return false;
    }
}

async function lintWithPrettier(files: string[]): Promise<boolean> {
    try {
        const checkFile = async (file: string): Promise<boolean> => {
            const options = await prettier.resolveConfig(file);
            const fileInfo = await prettier.getFileInfo(file);

            if (fileInfo.ignored) {
                return true;
            }

            const input = await readFile(file, 'utf8');
            const formatted = await prettier.check(input, {
                ...options,
                filepath: file,
            });

            if (!formatted) {
                console.error(`File ${file} is not formatted correctly`);
                return false;
            }

            return true;
        };

        const results = await Promise.all(files.map(checkFile));
        return results.every(result => result);
    } catch (error) {
        console.error('Prettier check failed:', (error as Error).message);
        return false;
    }
}

async function lintWithStylelint(
    patterns: string[],
    projectPath: string,
): Promise<boolean> {
    const result = await stylelint.lint({
        files: patterns,
        cwd: projectPath,
        formatter: 'string',
    });

    if (result.output) {
        console.log(result.output);
    }

    return !result.errored;
}

async function lintCommitMessage(message: string) {
    const config = await load({
        'extends': ['@commitlint/config-conventional'],
    });
    const result = await lint(message, config.rules, config);
    const output = format(
        { results: [result] },
        {
            signs: ['[hint]', '[warning]', '[error]'],
            color: true,
            verbose: false,
        },
    );
    console.log(output);
    if (!result.valid) {
        exit(1);
    }
}
