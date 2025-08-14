import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createUnplugin } from 'unplugin';
import { toEntrySubPathMap } from '../commands/build.js';
import type { ResolvedConfig } from '../config.js';

const buildStates = new Map<string, BuildState>();

export interface BuildState {
  completedBuilds: Set<string>;
  // key: `${normalizedEntryPath}-${conditionKey}`
  outputFiles: Map<string, OutputFileGroup>;
}

// 初始化构建状态
export function initializePackageExportsState(projectRoot: string) {
  const stateKey = projectRoot;
  if (!buildStates.has(stateKey)) {
    buildStates.set(stateKey, {
      completedBuilds: new Set(),
      outputFiles: new Map(),
    });
  }
}

// 最终化包导出，生成 package.json
export async function finalizePackageExports(
  projectRoot: string,
  entries: string[],
  config: ResolvedConfig,
) {
  const stateKey = projectRoot;
  const state = buildStates.get(stateKey);
  if (!state) return;

  const allCombinations = getAllConditionCombinations(
    config.web.build.conditions,
  );

  // 检查所有条件组合是否都已完成
  const isComplete = allCombinations.every(combo =>
    state.completedBuilds.has(JSON.stringify(combo)),
  );

  if (isComplete) {
    await updatePackageJson(projectRoot, entries, config, state.outputFiles);
    buildStates.delete(stateKey);
  }
}

// 标记条件组合构建完成
export function markConditionComplete(
  projectRoot: string,
  activeConditions: Record<string, string | boolean>,
) {
  const stateKey = projectRoot;
  const state = buildStates.get(stateKey);
  if (state) {
    const conditionKey = JSON.stringify(activeConditions);
    state.completedBuilds.add(conditionKey);
  }
}

interface OutputFileGroup {
  entryPath: string; // normalized entry path (./...)
  condition: string; // JSON string condition key
  files: Set<string>; // full relative file paths including outDir, e.g. dist/node/src/file.mjs
}

export function packageExports(
  config: ResolvedConfig,
  activeConditions: Record<string, string | boolean>,
  entries: string | string[],
  outDir: string, // 由 build.ts 传入的本次构建输出目录 (相对项目根)
) {
  if (!config.web.build.exports) {
    return createUnplugin(() => ({
      name: 'utc-package-exports-noop',
    })).rolldown();
  }

  const projectRoot = config.project;
  const conditionKey = JSON.stringify(activeConditions);
  const stateKey = projectRoot;
  const entryList = Array.isArray(entries) ? entries : [entries];

  return createUnplugin(() => {
    const collectBundleFiles = (bundle: Record<string, any>) => {
      const state = buildStates.get(stateKey);
      if (!state) return;
      for (const fileName in bundle) {
        const file = (bundle as any)[fileName];
        if (!file || file.type !== 'chunk') continue;
        const matchingEntry = entryList.find(entry => {
          const entryName = getEntryName(entry);
          return (
            fileName === `${entryName}.js`
            || fileName === `${entryName}.mjs`
            || fileName === `${entryName}.cjs`
            || fileName.endsWith(`/${entryName}.js`)
            || fileName.endsWith(`/${entryName}.mjs`)
            || fileName.endsWith(`/${entryName}.cjs`)
            || fileName.includes(`/${entryName}.`)
          );
        });
        if (!matchingEntry) continue;
        const normalizedEntry = matchingEntry.startsWith('./')
          ? matchingEntry
          : `./${matchingEntry}`;
        const key = `${normalizedEntry}-${conditionKey}`;
        const existing = state.outputFiles.get(key);
        const toPosix = (p: string) => p.replace(/\\/g, '/');
        const fullPath = toPosix(join(outDir, fileName));
        if (existing) existing.files.add(fullPath);
        else {
          state.outputFiles.set(key, {
            entryPath: normalizedEntry,
            condition: conditionKey,
            files: new Set([fullPath]),
          });
        }
      }
    };

    return {
      name: 'utc-package-exports',
      enforce: 'post',
      rolldown: {
        async writeBundle(_options, bundle) {
          collectBundleFiles(bundle);
        },
      },
    };
  }).rolldown();
}

function getAllConditionCombinations(
  conditions: string[] | Record<string, string[]> | undefined,
): Array<Record<string, string | boolean>> {
  if (!conditions) return [{}];

  if (Array.isArray(conditions)) {
    return conditions.map(condition => ({ [condition]: true }));
  }

  const groups = Object.entries(conditions);
  if (groups.length === 0) return [{}];

  const combinations: Array<Record<string, string>> = [];

  function generateCombinations(
    groupIndex: number,
    currentCombination: Record<string, string>,
  ) {
    if (groupIndex === groups.length) {
      combinations.push({ ...currentCombination });
      return;
    }

    const [groupName, groupConditions] = groups[groupIndex];
    for (const condition of groupConditions) {
      generateCombinations(groupIndex + 1, {
        ...currentCombination,
        [groupName]: condition,
      });
    }
  }

  generateCombinations(0, {});
  return combinations;
}

function extractFieldFromNestedExport(
  exportObj: any,
  field: string,
): string | undefined {
  if (!exportObj || typeof exportObj !== 'object') {
    return undefined;
  }

  if (typeof exportObj[field] === 'string') {
    return exportObj[field];
  }

  if (exportObj.default && typeof exportObj.default === 'object') {
    const defaultValue = extractFieldFromNestedExport(exportObj.default, field);
    if (defaultValue) return defaultValue;
  }

  for (const [key, value] of Object.entries(exportObj)) {
    if (key === 'default') continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nestedValue = extractFieldFromNestedExport(value, field);
      if (nestedValue) return nestedValue;
    }
  }

  return undefined;
}

// 沿条件组 default 链找到叶子 (仅用于对象型条件组)
function getLeafExportFollowingAllDefaults(
  rootExport: any,
  conditionGroups: Record<string, string[]>,
): any | undefined {
  if (!rootExport || typeof rootExport !== 'object') return undefined;
  const groupNames = Object.keys(conditionGroups);
  let current = rootExport;
  for (const group of groupNames) {
    // 若该组没有 default 直接失败
    const groupConditions = conditionGroups[group];
    if (!groupConditions.includes('default')) return undefined;
    if (!current || typeof current !== 'object') return undefined;
    current = current.default; // 进入 default 分支
  }
  return current && typeof current === 'object' ? current : undefined;
}

async function updatePackageJson(
  projectRoot: string,
  entries: string[],
  config: ResolvedConfig,
  outputFiles: Map<string, OutputFileGroup>,
) {
  const pkgPath = join(projectRoot, 'package.json');
  const pkgContent = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent);

  const subPathMap = toEntrySubPathMap(entries, projectRoot);
  const exportsField = buildExportsField(
    subPathMap,
    config,
    outputFiles,
    pkg.type,
  );

  let singleExport = {} as any;

  if (
    typeof exportsField['.'] === 'object'
    && !Array.isArray(exportsField['.'])
  ) {
    singleExport = exportsField['.'];
  }
  // 只有在「对象型条件组」且所有条件组都包含 default 时，才尝试赋值 main/module/types
  let assignTopLevel = true;
  const conds = config.web.build.conditions;
  let defaultLeaf: any | undefined;
  if (conds && !Array.isArray(conds)) {
    // 对象型条件: 所有组必须包含 default
    const groups = conds as Record<string, string[]>;
    assignTopLevel = Object.values(groups).every(arr =>
      arr.includes('default'),
    );
    if (assignTopLevel) {
      defaultLeaf = getLeafExportFollowingAllDefaults(singleExport, groups);
      // 如果 default 链没有最终叶子对象 (构建未生成)，则不赋值
      if (!defaultLeaf || Object.keys(defaultLeaf).length === 0)
        assignTopLevel = false;
    }
  } else if (conds && Array.isArray(conds)) {
    // 简单数组条件: 若存在 default 则允许提取; 沿原逻辑
    assignTopLevel = conds.includes('default');
    if (assignTopLevel) defaultLeaf = singleExport.default || singleExport;
  } else {
    // 无条件: 直接可赋值，从单一导出提取
    defaultLeaf = singleExport;
  }

  if (assignTopLevel && defaultLeaf) {
    const mainValue =
      typeof defaultLeaf.require === 'string'
        ? defaultLeaf.require
        : extractFieldFromNestedExport(defaultLeaf, 'require');
    const moduleValue =
      typeof defaultLeaf.import === 'string'
        ? defaultLeaf.import
        : extractFieldFromNestedExport(defaultLeaf, 'import');
    const typesValue =
      typeof defaultLeaf.types === 'string'
        ? defaultLeaf.types
        : extractFieldFromNestedExport(defaultLeaf, 'types');

    if (mainValue) pkg.main = mainValue;
    else delete pkg.main;
    if (moduleValue) pkg.module = moduleValue;
    else delete pkg.module;
    if (typesValue) pkg.types = typesValue;
    else delete pkg.types;
  } else {
    delete pkg.main;
    delete pkg.module;
    delete pkg.types;
  }

  pkg.exports = exportsField;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function buildExportsField(
  subPathMap: Record<string, string>,
  config: ResolvedConfig,
  outputFiles: Map<string, OutputFileGroup>,
  packageType: string | undefined,
): Record<string, any> {
  const exports: Record<string, any> = {};
  const conditions = config.web.build.conditions;

  for (const [subPath, entryPath] of Object.entries(subPathMap)) {
    if (!conditions) {
      // 单一条件构建，查找对应的输出文件
      const group = findOutputGroup(outputFiles, entryPath, '{}');
      if (group)
        exports[subPath] = createExportEntryFromOutputs(
          outputFiles,
          entryPath,
          '{}',
          packageType,
        );
    } else if (Array.isArray(conditions)) {
      exports[subPath] = createSimpleConditionalExportFromOutputs(
        outputFiles,
        entryPath,
        conditions,
        packageType,
      );
    } else {
      exports[subPath] = createNestedConditionalExportFromOutputs(
        outputFiles,
        entryPath,
        conditions,
        packageType,
      );
    }
  }

  return exports;
}

function getEntryName(entryPath: string): string {
  const relativePath = entryPath.replace(/^\.\//, '');
  const withoutExt = relativePath.replace(
    /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/,
    '',
  );
  return withoutExt.split('/').pop() || 'index';
}

function findOutputGroup(
  outputFiles: Map<string, OutputFileGroup>,
  entryPath: string,
  condition: string,
): OutputFileGroup | undefined {
  const normalizedPath = entryPath.startsWith('./')
    ? entryPath
    : `./${entryPath}`;
  return outputFiles.get(`${normalizedPath}-${condition}`);
}

function createExportEntryFromOutputs(
  outputFiles: Map<string, OutputFileGroup>,
  entryPath: string,
  condition: string,
  packageType: string | undefined,
): Record<string, string> {
  const group = findOutputGroup(outputFiles, entryPath, condition);
  if (!group) return {};

  // 收集各种后缀
  const dts: string[] = [];
  const mjs: string[] = [];
  const cjs: string[] = [];
  const plainJs: string[] = [];
  for (const f of group.files) {
    if (f.endsWith('.d.ts')) dts.push(f);
    else if (f.endsWith('.mjs')) mjs.push(f);
    else if (f.endsWith('.cjs')) cjs.push(f);
    else if (f.endsWith('.js')) plainJs.push(f);
  }

  const toExportPath = (p: string) => (p.startsWith('./') ? p : `./${p}`);

  const result: Record<string, string> = {};
  if (dts.length) result.types = toExportPath(dts[0]);

  // 策略: 优先 mjs 作为 import, cjs 作为 require. 若缺失, 用 js 兜底.
  if (mjs.length) {
    result.import = toExportPath(mjs[0]);
  }
  if (cjs.length) {
    result.require = toExportPath(cjs[0]);
  }

  // 只有 .js 时：同时兼容 import 与 require
  if (!mjs.length && !result.import && plainJs.length) {
    result.import = toExportPath(plainJs[0]);
  }
  if (!cjs.length && !result.require && plainJs.length) {
    result.require = toExportPath(plainJs[0]);
  }

  // default 逻辑：如果 package.type=commonjs，优先 require；否则优先 import
  if (packageType === 'commonjs') {
    if (result.require) result.default = result.require;
    else if (result.import) result.default = result.import;
  } else {
    if (result.import) result.default = result.import;
    else if (result.require) result.default = result.require;
  }

  return result;
}

function createSimpleConditionalExportFromOutputs(
  outputFiles: Map<string, OutputFileGroup>,
  entryPath: string,
  conditions: string[],
  packageType: string | undefined,
): Record<string, any> {
  const result: Record<string, any> = {};
  // 统一路径格式
  const normalizedPath = entryPath.startsWith('./')
    ? entryPath
    : `./${entryPath}`;

  for (const condition of conditions) {
    const conditionKey = JSON.stringify({ [condition]: true });
    const group = findOutputGroup(outputFiles, normalizedPath, conditionKey);
    if (group) {
      result[condition] = createExportEntryFromOutputs(
        outputFiles,
        normalizedPath,
        conditionKey,
        packageType,
      );
    }
  }

  // 查找 default 条件
  const defaultConditionKey = conditions.includes('default')
    ? JSON.stringify({ default: true })
    : '{}';
  const defaultGroup = findOutputGroup(
    outputFiles,
    normalizedPath,
    defaultConditionKey,
  );
  if (defaultGroup) {
    result.default = createExportEntryFromOutputs(
      outputFiles,
      normalizedPath,
      defaultConditionKey,
      packageType,
    );
  }

  return result;
}

function createNestedConditionalExportFromOutputs(
  outputFiles: Map<string, OutputFileGroup>,
  entryPath: string,
  conditionGroups: Record<string, string[]>,
  packageType: string | undefined,
): Record<string, any> {
  const groupNames = Object.keys(conditionGroups);
  // 统一路径格式
  const normalizedPath = entryPath.startsWith('./')
    ? entryPath
    : `./${entryPath}`;

  function buildLevel(
    level: number,
    currentConditions: Record<string, string>,
  ): Record<string, any> {
    if (level >= groupNames.length) {
      const conditionKey = JSON.stringify(currentConditions);
      const group = findOutputGroup(outputFiles, normalizedPath, conditionKey);
      if (!group) return {};
      return createExportEntryFromOutputs(
        outputFiles,
        normalizedPath,
        conditionKey,
        packageType,
      );
    }

    const groupName = groupNames[level];
    const groupConditions = conditionGroups[groupName];
    const result: Record<string, any> = {};

    for (const condition of groupConditions) {
      const nextConditions = { ...currentConditions, [groupName]: condition };
      const exportEntry = buildLevel(level + 1, nextConditions);
      if (exportEntry && Object.keys(exportEntry).length > 0) {
        result[condition] = exportEntry;
      }
    }

    // 处理 default 条件
    if (!result.default && groupConditions.includes('default')) {
      const defaultConditions = {
        ...currentConditions,
        [groupName]: 'default',
      };
      const defaultEntry = buildLevel(level + 1, defaultConditions);
      if (defaultEntry && Object.keys(defaultEntry).length > 0) {
        result.default = defaultEntry;
      }
    }

    return result;
  }

  const built = buildLevel(0, {});
  return built;
}
