import { cli } from '../cli.js';
import { resolveConfigFromArgv } from '../config.js';

cli.command(
  'test',
  'Run the tests.',
  yargs =>
    yargs
      // .option('watch', {
      //   alias: 'w',
      //   type: 'boolean',
      //   description: 'Watch mode.',
      //   default: false,
      // })
      .option('bench', {
        alias: 'b',
        type: 'boolean',
        description: 'Run only benchmark tests.',
        default: false,
      }),
  async args => {
    const config = await resolveConfigFromArgv(args);
    const { bench } = args;

    try {
      const { startVitest } = await import('vitest/node');
      const vitest = await startVitest(bench ? 'benchmark' : 'test', [], {
        root: config.project,
      });
      const testModules = vitest.state.getTestModules();
      let passed = 0;
      for (const testModule of testModules) {
        if (testModule.ok()) {
          passed++;
        } else {
          console.error(testModule.id, 'Failed:\n', ...testModule.errors());
        }
      }
      console.log(`${passed} out of ${testModules.length} tests passed`);

      process.exit(vitest.state.getCountOfFailedTests() > 0 ? 1 : 0);
    } catch (error) {
      console.error('Failed to start Vitest:', error);
      process.exit(1);
    }
  },
);
