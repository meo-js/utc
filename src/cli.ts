import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resolveConfigFromArgv } from './config.js';

export type Argv = typeof argv;

export const cli = yargs(hideBin(process.argv))
  .scriptName('utc')
  // 全局选项
  .option('project', {
    alias: 'p',
    describe: 'Project path.',
    type: 'string',
    defaultDescription: 'Current working directory',
    requiresArg: true,
  })
  .option('web.source', {
    describe: 'Web Source code paths.',
    type: 'string',
    defaultDescription: `src/**/*`,
  })
  .option('web.css', {
    describe: 'Use CSS.',
    type: 'boolean',
    defaultDescription: 'false',
  })
  .option('web.build.entry', {
    describe: 'Build entry points.',
    type: 'string',
    defaultDescription: 'Auto inference',
  })
  .option('web.build.strict', {
    describe: 'Enable stirct mode.',
    type: 'boolean',
    defaultDescription: 'false',
  })
  .option('web.build.conditions', {
    describe: 'Conditions config JSON (array or object).',
    type: 'string',
  })
  .option('web.build.compileConstantDts', {
    describe: 'Compile constant d.ts file path.',
    type: 'string',
    defaultDescription: 'src/compile-constant.d.ts',
  })
  .option('web.build.exports', {
    describe: 'Enable exports field in package.json.',
    type: 'boolean',
    defaultDescription: 'true',
  })
  .option('web.build.exportTypes', {
    describe: 'Generate `types` subpath when updating `exports` field.',
    type: 'boolean',
    defaultDescription: 'false',
  })
  .option('web.tailwindcss', {
    describe: 'Use Tailwind CSS.',
    type: 'boolean',
    defaultDescription: 'false',
  })
  .option('web.jsdoc', {
    describe: 'JSDoc check level for ESLint.',
    type: 'string',
    choices: ['none', 'loose', 'strict'] as const,
    defaultDescription: 'loose',
    requiresArg: true,
  })
  .command(
    '*',
    false,
    () => {},
    async args => {
      await printDebugInfo(args);
    },
  )
  // 配置
  .alias('v', 'version')
  .alias('h', 'help')
  // NOTE: yargs 不能很好地处理点号（.）分隔的选项
  .parserConfiguration({ 'dot-notation': false })
  .detectLocale(false)
  .demandCommand(1, 'You need at least one command before moving on.')
  .strict()
  .wrap(yargs().terminalWidth())
  .showHelpOnFail(false)
  .recommendCommands();

// 子命令
await import('./commands/init.js');
await import('./commands/build.js');
await import('./commands/lint.js');

const argv = await cli.parseAsync();

export async function printDebugInfo(args: Argv) {
  console.log('Cmd Args:', args);
  console.log('Config:', await resolveConfigFromArgv(args));
}
