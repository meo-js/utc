import { checkbox } from '@inquirer/prompts';
import { detectPackageManager, writePackageJson } from '@meojs/pkg-utils';
import { writeFile } from 'fs/promises';
import spawn from 'nano-spawn';
import {
  removeHooks,
  setHooksFromConfig,
} from 'simple-git-hooks/simple-git-hooks.js';
import cliPackageJson from '../../package.json' with { type: 'json' };
// FIXME: https://github.com/rolldown/tsdown/issues/445
// import cfgsPackageJson from '@meojs/cfgs/package.json' with { type: 'json' };
import cfgsPackageJson from '../cfgs-package-json.js';
import { cli } from '../cli.js';
import { hasConfig, resolveConfigFromArgv } from '../config.js';
import { simpleGitHooksConfigPath } from '../shared.js';

const simpleGitHooksConfig = {
  'pre-commit': '{PM} exec utc lint --staged',
  'commit-msg': '{PM} exec utc lint -m $1',
};

// Old version of peer dependencies to remove
const oldPeerDeps = { 'eslint': '', 'prettier': '', '@meojs/cfgs': '' };

cli.command(
  'init',
  'Initialize project.',
  argv =>
    argv.option('interactive', {
      alias: 'i',
      describe: 'Run in interactive mode.',
      type: 'boolean',
      default: false,
    }),
  async args => {
    const config = await resolveConfigFromArgv(args);
    const selected = [] as string[];

    if (args.interactive || !(await hasConfig(args.project))) {
      selected.push(
        ...(await checkbox({
          message: 'Select features to initialize:',
          choices: [
            {
              name: 'Git Hooks',
              value: 'git-hooks',
              checked: true,
            },
            {
              name: 'JavaScript',
              value: 'javascript',
              checked: false,
            },
            {
              name: 'Test',
              value: 'test',
              checked: false,
            },
            {
              name: 'CSS',
              value: 'css',
              checked: false,
            },
            {
              name: 'Tailwind CSS',
              value: 'tailwind',
              checked: false,
            },
            {
              name: 'Prepare Script',
              value: 'prepare-script',
              checked: true,
            },
          ],
        })),
      );
    } else {
      selected.push('git-hooks', 'javascript', 'prepare-script');
      if (config.web.css) {
        selected.push('css');
      }
      if (config.web.tailwindcss) {
        selected.push('tailwind');
      }
    }

    const actions: Record<string, (project: string) => Promise<void>> = {
      'git-hooks': installGitHooks,
      'javascript': installJavascriptDeps,
      'test': installTestDeps,
      'css': installCssDeps,
      'tailwind': installTailwindDeps,
      'prepare-script': installPrepareScript,
    };

    await runSelected(selected, config.project, actions);
  },
);

cli.command(
  'uninit',
  'Deinitialize project.',
  () => {},
  async args => {
    const config = await resolveConfigFromArgv(args);

    const selected = await checkbox({
      message: 'Select features to deinitialize:',
      choices: [
        {
          name: 'Git Hooks',
          value: 'git-hooks',
          checked: true,
        },
        {
          name: 'Remove Dependencies',
          value: 'remove-deps',
          checked: false,
        },
        {
          name: 'Remove Prepare Script',
          value: 'remove-prepare-script',
          checked: true,
        },
      ],
    });

    const actions: Record<string, (project: string) => Promise<void>> = {
      'git-hooks': uninstallGitHooks,
      'remove-deps': removeDependencies,
      'remove-prepare-script': uninstallPrepareScript,
    };

    await runSelected(selected, config.project, actions);
  },
);

cli
  .command(
    'install-git-hook',
    'Install Git hook scripts to ensure compliance with team specs before committing code.',
    () => {},
    async args => {
      const config = await resolveConfigFromArgv(args);
      await installGitHooks(config.project);
    },
  )
  .hide('install-git-hook');

cli
  .command(
    'uninstall-git-hook',
    'Uninstall Git hook scripts.',
    () => {},
    async args => {
      const config = await resolveConfigFromArgv(args);
      await uninstallGitHooks(config.project);
    },
  )
  .hide('uninstall-git-hook');

async function installGitHooks(projectPath: string) {
  console.log('Installing git hooks...');

  const pm = await getPackageManagerCmd(projectPath);
  const configContent = JSON.stringify(
    Object.fromEntries(
      Object.entries(simpleGitHooksConfig).map(([key, value]) => [
        key,
        value.replace(/\{PM\}/g, pm),
      ]),
    ),
    null,
    2,
  );

  await writeFile(simpleGitHooksConfigPath, configContent);
  await setHooksFromConfig(projectPath, ['', '', simpleGitHooksConfigPath]);
  console.log('Successfully set all git hooks.');
}

async function uninstallGitHooks(projectPath: string) {
  console.log('Uninstalling git hooks...');
  await removeHooks(projectPath);
  console.log('Successfully removed all git hooks.');
}

async function removeDependencies(projectPath: string) {
  console.log('Removing dependencies...');

  try {
    await writePackageJson(projectPath, json => {
      if (!json.devDependencies) {
        console.log('No devDependencies found in project package.json');
        return json;
      }

      const needRemovePeerDeps = Object.assign(
        {},
        oldPeerDeps,
        cliPackageJson.peerDependencies || {},
        cfgsPackageJson.peerDependencies || {},
      );
      const devDeps = json.devDependencies;

      Object.keys(needRemovePeerDeps).forEach(depName => {
        if (devDeps[depName]) {
          delete devDeps[depName];
          console.log(`Removed ${depName} from devDependencies`);
        }
      });
      return json;
    });

    console.log('Removed devDependencies used by utc.');
    await runPmInstall(projectPath);

    console.log('Dependencies removed successfully!');
  } catch (error) {
    console.error('Error removing dependencies:', error);
    throw error;
  }
}

async function installJavascriptDeps(projectPath: string) {
  return installPeerDepsByFilter(
    projectPath,
    'JavaScript',
    name => !isCssDep(name) && !isTailwindDep(name) && !isTestDep(name),
  );
}

async function installCssDeps(projectPath: string) {
  return installPeerDepsByFilter(projectPath, 'CSS', isCssDep);
}

async function installTailwindDeps(projectPath: string) {
  return installPeerDepsByFilter(projectPath, 'Tailwind CSS', isTailwindDep);
}

async function installTestDeps(projectPath: string) {
  return installPeerDepsByFilter(projectPath, 'Test', isTestDep);
}

const isCssDep = (name: string) =>
  name.startsWith('stylelint') || name.startsWith('postcss');

const isTailwindDep = (name: string) => name.includes('tailwindcss');

const isTestDep = (name: string) => name.includes('vitest');

function collectPeerDepsByFilter(
  include: (name: string) => boolean,
): Record<string, string> {
  const cliPeerDeps = cliPackageJson.peerDependencies || {};
  const cfgsPeerDeps = cfgsPackageJson.peerDependencies || {};

  const result: Record<string, string> = {};

  Object.keys(cliPeerDeps)
    .filter(include)
    .forEach(name => {
      result[name] = cliPeerDeps[name as never];
    });

  Object.keys(cfgsPeerDeps)
    .filter(include)
    .forEach(name => {
      result[name] = cfgsPeerDeps[name as never];
    });

  return result;
}

async function installPeerDepsByFilter(
  projectPath: string,
  label: string,
  include: (name: string) => boolean,
) {
  console.log(`Installing ${label} dependencies...`);

  try {
    const deps = collectPeerDepsByFilter(include);

    if (Object.keys(deps).length === 0) {
      console.log(`No ${label} peer dependencies found to install.`);
      return;
    }

    await writePackageJson(projectPath, json => {
      if (!json.devDependencies) json.devDependencies = {};
      const devDeps = json.devDependencies;
      for (const [name, version] of Object.entries(deps)) {
        devDeps[name] = version;
      }
      return json;
    });

    console.log(`Updated devDependencies for ${label}.`);
    await runPmInstall(projectPath);

    console.log(`${label} dependencies installed successfully!`);
  } catch (error) {
    console.error(`Error installing ${label} dependencies:`, error);
    throw error;
  }
}

async function installPrepareScript(projectPath: string) {
  console.log('Installing prepare script...');

  try {
    const pm = await getPackageManagerCmd(projectPath);
    const prepareScript = `${pm} exec utc install-git-hook`;

    await writePackageJson(projectPath, json => {
      if (!json.scripts) {
        json.scripts = {};
      }
      json.scripts.prepare = prepareScript;
      return json;
    });

    console.log('Successfully installed prepare script in package.json');
  } catch (error) {
    console.error('Error installing prepare script:', error);
    throw error;
  }
}

async function uninstallPrepareScript(projectPath: string) {
  console.log('Uninstalling prepare script...');

  try {
    await writePackageJson(projectPath, json => {
      if (!json.scripts) {
        console.log('No scripts found in package.json');
        return json;
      }

      if (json.scripts.prepare) {
        delete json.scripts.prepare;
        console.log('Removed prepare script from package.json');
      } else {
        console.log('No prepare script found in package.json');
      }
      return json;
    });

    console.log('Successfully uninstalled prepare script');
  } catch (error) {
    console.error('Error uninstalling prepare script:', error);
    throw error;
  }
}

async function getPackageManagerCmd(projectPath: string): Promise<string> {
  return (await detectPackageManager(projectPath)).cmd;
}

async function runPmInstall(projectPath: string) {
  console.log('Running install...');
  const pm = await getPackageManagerCmd(projectPath);
  await spawn(pm, ['install'], { cwd: projectPath, stdio: 'inherit' });
}

async function runSelected(
  selected: string[],
  project: string,
  actionMap: Record<string, (project: string) => Promise<void>>,
) {
  for (const key of selected) {
    const action = actionMap[key];
    if (action) await action(project);
  }
}
