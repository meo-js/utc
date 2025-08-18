import { checkbox } from '@inquirer/prompts';
import { detectPackageManager, writePackageJson } from '@meojs/pkg-utils';
import { readFile, writeFile } from 'fs/promises';
import spawn from 'nano-spawn';
import { dirname, join } from 'path';
import {
  removeHooks,
  setHooksFromConfig,
} from 'simple-git-hooks/simple-git-hooks.js';
import cliPackageJson from '../../package.json' with { type: 'json' };
// FIXME: https://github.com/rolldown/tsdown/issues/445
// import cfgsPackageJson from '@meojs/cfgs/package.json' with { type: 'json' };
import cfgsPackageJson from '../cfgs-package-json.js';
import vscodeExtensionsCfg from '../cfgs-vscode-extensions.js';
import vscodeSettingsCfg from '../cfgs-vscode-settings.js';
import { cli } from '../cli.js';
import { hasConfig, resolveConfigFromArgv } from '../config.js';
import {
  repoEditorconfigTemplatePath,
  repoEslintConfigTemplatePath,
  repoPrettierConfigTemplatePath,
  repoStylelintConfigTemplatePath,
  repoTsconfigTemplatePath,
  repoVitestConfigTemplatePath,
  simpleGitHooksConfigPath,
} from '../shared.js';

const simpleGitHooksConfig = {
  'pre-commit': '{PM} exec utc lint --staged',
  'commit-msg': '{PM} exec utc lint -m $1',
};

// Old version of peer dependencies to remove
const oldPeerDeps = { '@meojs/cfgs': '' };

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

    await runInitSelected(selected, config.project);
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

// ---- Dependency classification helpers ----
// Predicates are defined below; constants created after definitions to avoid TDZ issues.

const isCssDep = (name: string) =>
  name.startsWith('stylelint') || name.startsWith('postcss');

const isTailwindDep = (name: string) => name.includes('tailwindcss');

const isTestDep = (name: string) => name.includes('vitest');

// Derived filter constants (after predicate declarations)
const JS_FILTER = (name: string) =>
  !isCssDep(name) && !isTailwindDep(name) && !isTestDep(name);
const CSS_FILTER = isCssDep;
const TAILWIND_FILTER = isTailwindDep;
const TEST_FILTER = isTestDep;

// Feature descriptor map to reduce branching duplication
interface FeatureSpec {
  filter?: (name: string) => boolean; // peer dep filter
  files?: { target: string; template: string }[]; // config/template files to ensure
  addCfgs?: boolean; // whether needs @meojs/cfgs dependency
  removeExtensions?: RegExp[]; // VSCode extension id patterns to remove if feature NOT selected
}

const FEATURE_SPECS: Record<string, FeatureSpec> = {
  javascript: {
    filter: JS_FILTER,
    addCfgs: true,
    files: [
      { target: 'tsconfig.json', template: repoTsconfigTemplatePath },
      { target: 'eslint.config.js', template: repoEslintConfigTemplatePath },
      {
        target: 'prettier.config.js',
        template: repoPrettierConfigTemplatePath,
      },
    ],
    removeExtensions: [/eslint/i, /prettier/i],
  },
  css: {
    filter: CSS_FILTER,
    files: [
      {
        target: 'stylelint.config.js',
        template: repoStylelintConfigTemplatePath,
      },
    ],
    removeExtensions: [/stylelint/i],
  },
  tailwind: { filter: TAILWIND_FILTER },
  test: {
    filter: TEST_FILTER,
    files: [
      { target: 'vitest.config.js', template: repoVitestConfigTemplatePath },
    ],
  },
  // always copied regardless of selection handled separately (.editorconfig)
};

function collectPeerDepsByFilter(include: (name: string) => boolean) {
  const result: Record<string, string> = {};
  for (const source of [
    cliPackageJson.peerDependencies,
    cfgsPackageJson.peerDependencies,
  ]) {
    const deps = source || {};
    for (const name of Object.keys(deps)) {
      if (include(name)) result[name] = deps[name as never];
    }
  }
  return result;
}
// ---- Unified init pipeline ----
async function runInitSelected(selected: string[], project: string) {
  // Immediate actions (not part of feature spec)
  if (selected.includes('git-hooks')) await installGitHooks(project);
  if (selected.includes('prepare-script')) await installPrepareScript(project);

  // Build dependency filters & file tasks from specs
  const filters: ((name: string) => boolean)[] = [];
  const filesToEnsure: { target: string; template: string }[] = [];
  let addCfgs = false;

  for (const key of selected) {
    const spec = FEATURE_SPECS[key];
    if (!spec) continue;
    if (spec.filter) filters.push(spec.filter);
    if (spec.files) filesToEnsure.push(...spec.files);
    if (spec.addCfgs) addCfgs = true;
  }

  const mergedDeps: Record<string, string> = {};
  if (filters.length) {
    const allDeps = collectPeerDepsByFilter(mergeFilters(filters));
    Object.assign(mergedDeps, allDeps);
  }
  if (addCfgs) {
    const cfgsVersion = (cliPackageJson.dependencies || {})['@meojs/cfgs'];
    if (cfgsVersion) mergedDeps['@meojs/cfgs'] = cfgsVersion;
  }

  let wrote = false;
  if (Object.keys(mergedDeps).length) {
    await writePackageJson(project, json => {
      if (!json.devDependencies) json.devDependencies = {};
      const dev = json.devDependencies;
      let changed = false;
      for (const [name, version] of Object.entries(mergedDeps)) {
        if (!dev[name]) {
          dev[name] = version;
          changed = true;
          console.log(`Added devDependency: ${name}@${version}`);
        }
      }
      if (!changed) console.log('No new devDependencies to add.');
      wrote = changed;
      return json;
    });
  }
  if (wrote) await runPmInstall(project);

  // Ensure config/template files
  for (const f of filesToEnsure) {
    await ensureFile(project, f.target, f.template, f.target);
  }
  // Always ensure .editorconfig
  await ensureFile(
    project,
    '.editorconfig',
    repoEditorconfigTemplatePath,
    '.editorconfig',
  );

  await generateVSCodeExtensions(selected, project);
  await writeVSCodeSettings(project);
}

function mergeFilters(filters: ((name: string) => boolean)[]) {
  if (filters.length === 1) return filters[0];
  return (name: string) => filters.some(f => f(name));
}

async function ensureFile(
  projectPath: string,
  relativeTarget: string,
  templateAbsPath: string,
  label: string,
) {
  const target = join(projectPath, relativeTarget);
  // ensure parent directory exists (covers potential nested targets in future)
  await ensureDir(dirname(target));
  try {
    await readFile(target);
    console.log(`${label} already exists in project, skip copy.`);
  } catch {
    const content = await readFile(templateAbsPath, 'utf8');
    await writeFile(target, content, 'utf8');
    console.log(`Copied ${label} to project root.`);
  }
}

async function generateVSCodeExtensions(
  selected: string[],
  projectPath: string,
) {
  try {
    const rec: string[] = [...(vscodeExtensionsCfg.recommendations || [])];
    // For each feature spec with removeExtensions, if feature NOT selected -> remove patterns
    for (const [feature, spec] of Object.entries(FEATURE_SPECS)) {
      if (!spec.removeExtensions) continue;
      if (selected.includes(feature)) continue; // keep if selected
      for (const pattern of spec.removeExtensions) removeBy(rec, pattern);
    }

    const content = JSON.stringify({ recommendations: rec }, null, 2);
    const dir = join(projectPath, '.vscode');
    await ensureDir(dir);
    const file = join(dir, 'extensions.json');
    await writeFile(file, content + '\n', 'utf8');
    console.log('Wrote .vscode/extensions.json');
  } catch (e) {
    console.error('Failed to write VSCode extensions.json:', e);
  }
}

async function writeVSCodeSettings(projectPath: string) {
  try {
    const dir = join(projectPath, '.vscode');
    await ensureDir(dir);
    const file = join(dir, 'settings.json');
    const content = JSON.stringify(vscodeSettingsCfg, null, 2);
    await writeFile(file, content + '\n', 'utf8');
    console.log('Wrote .vscode/settings.json');
  } catch (e) {
    console.error('Failed to write VSCode settings.json:', e);
  }
}

function removeBy(arr: string[], pattern: RegExp) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pattern.test(arr[i])) arr.splice(i, 1);
  }
}

async function ensureDir(path: string) {
  // dynamic import to avoid adding global fs dependency at top
  const { mkdir } = await import('fs/promises');
  await mkdir(path, { recursive: true });
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
