import format from '@commitlint/format';
import lint from '@commitlint/lint';
import load from '@commitlint/load';
import { execSync } from 'child_process';
import { ESLint } from 'eslint';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import * as prettier from 'prettier';
import { exit } from 'process';
import { cli } from '../cli.js';
import { resolveConfigFromArgv, type ResolvedConfig } from '../config.js';

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

            const passed = await lintJsFiles(stagedFiles, config, true);

            if (!passed) {
                process.exit(1);
            }

            console.log('All staged files passed linting checks.');
        } else {
            const passed = await lintJsFiles([], config, false);
            if (!passed) {
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
    if (isStaged) {
        const targetFiles = await filterJsFiles(
            stagedFiles,
            config.js.source,
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
            lintWithESLint(config.js.source, config.project),
            lintWithPrettierByGlob(config.js.source, config.project),
        ]);

        return eslintPassed && prettierPassed;
    }
}

async function filterJsFiles(
    files: string[],
    sourcePatterns: string[],
    projectPath: string,
): Promise<string[]> {
    const allSourceFiles = await getSourceFiles(sourcePatterns, projectPath);
    const sourceFilesSet = new Set(
        allSourceFiles.map(file => file.replace(`${projectPath}/`, '')),
    );

    return files.filter(file => sourceFilesSet.has(file));
}

async function getSourceFiles(
    sourcePatterns: string[],
    projectPath: string,
): Promise<string[]> {
    const allFiles: string[] = [];

    for (const pattern of sourcePatterns) {
        const files = await glob(pattern, {
            cwd: projectPath,
            absolute: true,
            nodir: true,
        });
        allFiles.push(...files);
    }

    return [...new Set(allFiles)];
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

async function lintWithPrettierByGlob(
    sourcePatterns: string[],
    projectPath: string,
): Promise<boolean> {
    const targetFiles = await getSourceFiles(sourcePatterns, projectPath);
    return lintWithPrettier(targetFiles);
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
