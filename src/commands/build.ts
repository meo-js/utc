import {
  checkPackage,
  createPackageFromTarballData,
  type Problem,
} from '@arethetypeswrong/core';
import { glob } from '@meojs/cfgs';
import { readPackageJson, type PackageJson } from '@meojs/pkg-utils';
import { exec } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';
import { Project } from 'ts-morph';
import {
  build,
  type Options,
  type TsdownChunks,
  type TsdownHooks,
} from 'tsdown';
import { promisify } from 'util';
import { cli } from '../cli.js';
import { resolveConfigFromArgv, type ResolvedConfig } from '../config.js';
import { binHelper } from '../plugins/bin-helper.js';
import { compileConstant } from '../plugins/compile-constant.js';
import {
  buildResolveConfig,
  normalizeMatchPath,
  resolveGlob,
} from '../shared.js';

const { scriptExt, scriptExts } = glob;

cli.command(
  'build',
  'Build the project.',
  () => {},
  async args => {
    const config = await resolveConfigFromArgv(args);
    let pkg = await readPackageJson(config.project);

    const conditionCombinations = getConditionCombinations(
      config.web.build.conditions,
    );

    try {
      await rm(join(config.project, 'dist'), { recursive: true });
    } catch (error) {}

    const needExports = config.web.build.exports;
    const { entry, bin } = await getEntry(pkg, config);
    const buildResults: BuildResult[] = [];

    for (const combination of conditionCombinations) {
      const result = await buildSingle(entry, config, combination);
      buildResults.push(result);
    }

    const binResults = await buildBin(bin, config, pkg);

    if (needExports) {
      pkg = await generatePackageExports(
        config.project,
        entry,
        config,
        buildResults,
      );
    }

    if (binResults.length !== 0) {
      await generatePackageJsonBin(config.project, bin, binResults, pkg);
    }

    await generateCompileConstantDts(config);

    if (config.web.build.strict) {
      await runPublintCheck(config.project);
      await runAttwCheck(config.project);
    }
  },
);

async function buildBin(
  bin: Record<string, string>,
  config: ResolvedConfig,
  pkg: PackageJson,
) {
  const keys = Object.keys(bin);
  const count = keys.length;
  if (count === 0) {
    return [];
  }

  const conditions = config.web.build.bin?.activeConditions ?? {};
  let activeConditions: Record<string, string | boolean>;
  if (Array.isArray(conditions)) {
    activeConditions = conditions.reduce(
      (acc, name) => {
        acc[name] = true;
        return acc;
      },
      {} as Record<string, string | boolean>,
    );
  } else {
    activeConditions = conditions;
  }

  const results: BuildResult[] = [];

  if (count === 1 && keys[0] === pkg.name) {
    results.push(
      await buildSingle([bin[keys[0]]], config, activeConditions, '_bin'),
    );
  } else {
    for (const key in bin) {
      results.push(
        await buildSingle([bin[key]], config, activeConditions, `_bin/${key}`),
      );
    }
  }

  return results;
}

function getConditionCombinations(
  conditions: string[] | Record<string, string[]> | undefined,
) {
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

interface BuildResult {
  chunks: TsdownChunks;
  activeConditions: Record<string, string | boolean>;
  outDir: string;
}

async function buildSingle(
  entry: string[],
  config: ResolvedConfig,
  activeConditions: Record<string, string | boolean>,
  binPath?: string,
): Promise<BuildResult> {
  const isBin = binPath != null;
  const outDirSuffix = isBin ? binPath : generateOutDirSuffix(activeConditions);

  const outDir = outDirSuffix ? `dist/${outDirSuffix}` : 'dist';
  let finalChunks!: TsdownChunks;

  const options: Options = {
    cwd: config.project,
    entry,
    sourcemap: true,
    dts: !isBin,
    treeshake: true,
    target: 'esnext',
    platform: config.web.platform,
    unbundle: true,
    format: isBin ? 'esm' : ['esm', 'cjs'],
    outDir,
    define: {
      'import.meta.vitest': 'undefined',
    },
    hooks: {},
    exports: {
      customExports(exports, context) {
        finalChunks = context.chunks;
        return exports;
      },
    },
    plugins: [
      compileConstant(config.web.build.conditions, activeConditions).rolldown(),
      ...(isBin ? [binHelper()] : []),
    ],
    inputOptions: {
      resolve: buildResolveConfig(activeConditions),
      onLog: (level, log, defaultHandler) => {
        if (log.code === 'UNRESOLVED_IMPORT') {
          defaultHandler('error', log);
          return;
        }
        defaultHandler(level, log);
      },
    },
  };

  if (config.web.build.entry == null) {
    // TODO: 未完成的逻辑，用于 watch
    if (isBin) {
      // TODO
    } else {
      (<TsdownHooks>options.hooks)['build:prepare'] = async ctx => {
        const { entry } = await getEntry(
          await readPackageJson(config.project),
          config,
        );
        ctx.options.entry = entry;
      };
    }
  }

  await build(options);

  return {
    chunks: finalChunks,
    activeConditions,
    outDir,
  };
}

function generateOutDirSuffix(
  activeConditions: Record<string, string | boolean>,
) {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(activeConditions)) {
    if (typeof value === 'boolean' && value) {
      parts.push(key);
    } else if (typeof value === 'string') {
      parts.push(value);
    }
  }

  return parts.length > 0 ? parts.join('/') : '';
}

async function generatePackageJsonBin(
  projectRoot: string,
  originalBin: Record<string, string>,
  binResults: BuildResult[],
  pkg: PackageJson,
) {
  const pkgPath = join(projectRoot, 'package.json');

  const binKeys = Object.keys(originalBin);

  if (binKeys.length === 1 && binKeys[0] === pkg.name) {
    const result = binResults[0];
    const binFile = findExecutableFile(result);
    pkg.bin = binFile;
  } else {
    if (binKeys.length === 0) {
      delete pkg.bin;
    } else {
      const binField: Record<string, string> = {};
      for (let i = 0; i < binKeys.length; i++) {
        const key = binKeys[i];
        const result = binResults[i];
        const binFile = findExecutableFile(result);
        binField[key] = binFile ?? '';
      }
      pkg.bin = binField;
    }
  }

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function findExecutableFile(result: BuildResult): string | undefined {
  const { chunks, outDir } = result;

  for (const chunkArray of Object.values(chunks)) {
    for (const chunk of chunkArray || []) {
      if (chunk.type === 'chunk' && chunk.isEntry) {
        return `./${join(outDir, chunk.fileName).replace(/\\/g, '/')}`;
      }
    }
  }

  for (const chunkArray of Object.values(chunks)) {
    for (const chunk of chunkArray || []) {
      if (chunk.type === 'chunk') {
        return `./${join(outDir, chunk.fileName).replace(/\\/g, '/')}`;
      }
    }
  }

  return undefined;
}

async function generateCompileConstantDts(config: ResolvedConfig) {
  const conditions = config.web.build.conditions;
  const file = config.web.build.compileConstantDts;
  if (!conditions || !file) return;
  let output = '// #region Generated compile constants\n';
  function emitGroup(
    prefix: string | undefined,
    list: string[],
    last: boolean,
  ) {
    const upper = (s: string) => s.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    const lines = list
      .map(c => `  export const ${upper(c)}: boolean;`)
      .join('\n');
    const mod = prefix ? `compile-constant/${prefix}` : 'compile-constant';
    output += `declare module '${mod}' {\n${lines}\n}\n${last ? '' : '\n'}`;
  }
  if (Array.isArray(conditions)) {
    emitGroup(undefined, conditions, true);
  } else {
    const arr = [...Object.entries(conditions).entries()];
    for (const [index, [group, list]] of arr)
      emitGroup(group, list, index === arr.length - 1);
  }
  output += '// #endregion\n';
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, output, 'utf8');
}

async function getEntry(
  pkg: PackageJson,
  config: ResolvedConfig,
): Promise<{ entry: string[]; bin: Record<string, string> }> {
  let entry: string[];
  if (config.web.build.entry) {
    entry = Array.isArray(config.web.build.entry)
      ? config.web.build.entry
      : [config.web.build.entry];
  } else {
    entry = await getAllRootModules(config);
  }

  if (entry.length === 0) {
    entry.push('./src/index.ts');
  }

  const bin = await getAllBinModules(pkg, config);

  return { entry, bin };
}

async function getAllRootModules(config: ResolvedConfig): Promise<string[]> {
  const projectRoot = config.project;
  const sourceGlobs = config.web.source;

  const files = await resolveGlob(sourceGlobs, projectRoot, scriptExt);

  if (files.length === 0) {
    console.warn('未匹配到任何源码文件，跳过入口自动推断。');
    return [];
  }

  const project = new Project({});
  const rootEntries: string[] = [];

  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    let moduleCommentBlocks: string[] = [];
    try {
      const statements = sourceFile.getStatements();
      if (statements.length) {
        const first = statements[0];
        const leading = first.getLeadingCommentRanges();
        for (const r of leading) {
          const text = r.getText();
          if (/^\/\*\*/.test(text)) {
            moduleCommentBlocks.push(text);
          }
        }
      } else {
        const fullText = sourceFile.getFullText();
        const match = fullText.match(/^\/\*\*[\s\S]*?\*\//);
        if (match) moduleCommentBlocks.push(match[0]);
      }
    } catch (e) {}

    if (!moduleCommentBlocks.length) continue;

    const doc = moduleCommentBlocks[0];
    const isModule = /@module\b/.test(doc);
    const isPublic = /@public\b/.test(doc);
    if (isModule && isPublic) {
      rootEntries.push(file);
    }
  }

  if (!rootEntries.length) {
    console.warn('未发现任何根模块。');
    return [];
  }

  return rootEntries.map(p => {
    const rel = relative(projectRoot, p);
    return rel.startsWith('.') ? rel : `./${rel}`;
  });
}

async function getAllBinModules(
  pkg: PackageJson,
  config: ResolvedConfig,
): Promise<Record<string, string>> {
  const projectRoot = config.project;
  const sourceGlobs = config.web.source;

  const files = await resolveGlob(sourceGlobs, projectRoot, scriptExt);

  if (files.length === 0) {
    return {};
  }

  const project = new Project({});
  const binEntries: Record<string, string> = {};

  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    let moduleCommentBlocks: string[] = [];
    try {
      const statements = sourceFile.getStatements();
      if (statements.length) {
        const first = statements[0];
        const leading = first.getLeadingCommentRanges();
        for (const r of leading) {
          const text = r.getText();
          if (/^\/\*\*/.test(text)) {
            moduleCommentBlocks.push(text);
          }
        }
      } else {
        const fullText = sourceFile.getFullText();
        const match = fullText.match(/^\/\*\*[\s\S]*?\*\//);
        if (match) moduleCommentBlocks.push(match[0]);
      }
    } catch (e) {}

    if (!moduleCommentBlocks.length) continue;

    const doc = moduleCommentBlocks[0];
    const binMatches = doc.matchAll(/@bin(?:\s+([^*\s]+))?/g);
    for (const binMatch of binMatches) {
      const binId = binMatch[1]?.trim() ?? pkg.name!;
      const relativePath = relative(projectRoot, file);
      const finalPath = relativePath.startsWith('.')
        ? relativePath
        : `./${relativePath}`;
      binEntries[binId] = finalPath;
    }
  }

  return binEntries;
}

export function toEntrySubPathMap(paths: string[], projectRoot: string) {
  if (!paths.length) return {} as Record<string, string>;

  interface ModuleInfo {
    file: string;
    custom?: string;
    auto: string;
    final: string;
  }

  const normalizedFiles = paths.map(v => normalizeMatchPath(v, projectRoot));
  const project = new Project({
    useInMemoryFileSystem: false,
    skipFileDependencyResolution: true,
  });

  let root = '';
  if (normalizedFiles.length === 1) {
    root = dirname(normalizedFiles[0]);
  } else {
    const segsList = normalizedFiles.map(p => p.split('/'));
    let common: string[] = [];
    for (let i = 0; ; i++) {
      const seg = segsList[0][i];
      if (seg == null) break;
      if (segsList.every(s => s[i] === seg)) common.push(seg);
      else break;
    }
    root = common.join('/') || projectRoot;
  }

  const modules: ModuleInfo[] = [];
  const customPathSet = new Map<string, string>();

  for (const file of normalizedFiles) {
    let custom: string | undefined;
    try {
      const sourceFile = project.addSourceFileAtPath(file);
      const statements = sourceFile.getStatements();
      let jsdocText = '';
      if (statements.length) {
        const first = statements[0];
        const leading = first.getLeadingCommentRanges();
        const firstJSDoc = leading.find(r => /^\/\*\*/.test(r.getText()));
        if (firstJSDoc) jsdocText = firstJSDoc.getText();
      } else {
        const full = sourceFile.getFullText();
        const match = full.match(/^\/\*\*[\s\S]*?\*\//);
        if (match) jsdocText = match[0];
      }
      if (jsdocText) {
        const m = jsdocText.match(/@modulePath\s+([^*\s]+)/);
        if (m) {
          let sub = m[1].trim();
          sub = sub.replace(/^['"`]|['"`]$/g, '');

          // 统一根路径写法
          // 允许: '.', './', './.', '' => '.'
          if (sub === '' || sub === '.' || sub === './' || sub === './.') {
            sub = '.';
          } else if (sub.startsWith('./')) {
            // 保留 './foo'
          } else {
            sub = './' + sub.replace(/^\/+/, '');
          }

          // 去掉结尾 '/'
          sub = sub.replace(/\/$/, '');

          // 再次折叠 './.' => '.' (防御性)
          if (sub === './.') sub = '.';

          if (sub !== '.' && !sub.startsWith('./')) {
            throw new Error(
              `@modulePath 必须以 ./ 开头或为 '.' (${file} => ${sub})`,
            );
          }

          custom = sub;
        }
      }
    } catch (e) {}

    const auto = toEntrySubPath(root, file);
    const final = custom ?? auto;

    const existed = customPathSet.get(final);
    if (existed && existed !== file) {
      throw new Error(
        `子路径冲突: '${final}' 同时由 '${existed}' 与 '${file}' 定义。`,
      );
    }
    customPathSet.set(final, file);

    modules.push({ file, custom, auto, final });
  }

  const map: Record<string, string> = {};
  for (const m of modules) {
    map[m.final] = m.file;
  }
  return map;
}

export function toEntrySubPath(root: string, path: string) {
  let rel = normalizeMatchPath(path, root);

  if (rel === '.') {
    rel = '';
  }

  const sortedExts = [...scriptExts].sort((a, b) => b.length - a.length);
  for (const ext of sortedExts) {
    if (rel.toLowerCase().endsWith('.' + ext.toLowerCase())) {
      rel = rel.slice(0, -(ext.length + 1));
      break;
    }
  }

  rel = rel.replace(/(^|\/)index$/i, '$1').replace(/\/$/, '');

  if (!rel) return '.';
  return rel.startsWith('.') ? rel : './' + rel;
}

async function generatePackageExports(
  projectRoot: string,
  entries: string[],
  config: ResolvedConfig,
  buildResults: BuildResult[],
): Promise<PackageJson> {
  const pkgPath = join(projectRoot, 'package.json');
  const pkgContent = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent);

  const subPathMap = toEntrySubPathMap(entries, projectRoot);
  const outputFiles = collectOutputFiles(entries, buildResults);
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

  let assignTopLevel = true;
  const conds = config.web.build.conditions;
  let defaultLeaf: any | undefined;

  if (conds && !Array.isArray(conds)) {
    const groups = conds as Record<string, string[]>;
    assignTopLevel = Object.values(groups).every(arr =>
      arr.includes('default'),
    );
    if (assignTopLevel) {
      defaultLeaf = getLeafExportFollowingAllDefaults(singleExport, groups);
      if (!defaultLeaf || Object.keys(defaultLeaf).length === 0)
        assignTopLevel = false;
    }
  } else if (conds && Array.isArray(conds)) {
    assignTopLevel = conds.includes('default');
    if (assignTopLevel) defaultLeaf = singleExport.default || singleExport;
  } else {
    defaultLeaf = singleExport;
  }

  if (assignTopLevel && defaultLeaf) {
    function branchPath(branch: any): string | undefined {
      if (!branch) return undefined;
      if (typeof branch === 'string') return branch;
      if (typeof branch === 'object') {
        if (typeof branch.default === 'string') return branch.default;
      }
      return undefined;
    }
    function branchTypes(branch: any): string | undefined {
      if (!branch || typeof branch !== 'object') return undefined;
      if (typeof branch.types === 'string') return branch.types;
      if (branch.default && typeof branch.default === 'object') {
        if (typeof branch.default.types === 'string')
          return branch.default.types;
      }
      return undefined;
    }

    const requireBranch = defaultLeaf.require;
    const importBranch = defaultLeaf.import;
    const mainValue = branchPath(requireBranch);
    const moduleValue = branchPath(importBranch);
    let typesValue = branchTypes(requireBranch);

    if (mainValue) pkg.main = mainValue;
    else delete pkg.main;
    if (moduleValue) pkg.module = moduleValue;
    else delete pkg.module;

    // 如果 exports 中没有写出 types （exportTypes 可能为 false），尝试根据 main/module 推断
    if (!typesValue) {
      // 只允许基于 CJS (main) 路径推断 types，不使用 ESM(module)
      const preferScript = mainValue;
      if (preferScript) {
        // preferScript 形如 './dist/xxx.mjs'，去掉前缀 './'
        const scriptPath = preferScript.replace(/^\.\//, '');
        const scriptRoot = scriptPath.replace(/(\.mjs|\.cjs|\.js)$/i, '');
        // 构造候选顺序，参考 createExportEntryFromOutputs 内部逻辑（与 package.type 相关）
        const rankOrder = (() => {
          if (/\.mjs$/i.test(preferScript))
            return ['.d.mts', '.d.ts', '.d.cts'];
          if (/\.cjs$/i.test(preferScript))
            return ['.d.cts', '.d.ts', '.d.mts'];
          if (/\.js$/i.test(preferScript)) {
            if (pkg.type === 'module') return ['.d.ts', '.d.mts', '.d.cts'];
            if (pkg.type === 'commonjs') return ['.d.cts', '.d.ts', '.d.mts'];
          }
          return ['.d.ts', '.d.cts', '.d.mts'];
        })();

        // 在当前 build 产生的 outputFiles 中查找匹配
        const allOutputFiles: string[] = [];
        for (const g of outputFiles.values()) {
          for (const f of g.files) allOutputFiles.push(f.replace(/\\/g, '/'));
        }
        for (const ext of rankOrder) {
          const candidate = scriptRoot + ext; // 相对路径（不含 './'）
          // outputFiles 里的路径是 'dist/...' 形式
          const match = allOutputFiles.find(
            f => f === candidate || f.endsWith('/' + candidate),
          );
          if (match) {
            typesValue = './' + match.replace(/^[.\/]+/, '');
            break;
          }
        }
      }
    }

    if (typesValue) pkg.types = typesValue;
    else delete pkg.types;
  } else {
    delete pkg.main;
    delete pkg.module;
    delete pkg.types;
  }

  pkg.exports = exportsField;
  pkg.exports['./package.json'] = './package.json';

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  return pkg;
}

function collectOutputFiles(
  entries: string[],
  buildResults: BuildResult[],
): Map<string, OutputFileGroup> {
  const outputFiles = new Map<string, OutputFileGroup>();

  // Precompute entry names (basename without extension) -> original entry path
  const entryNameMap = new Map<string, string>();
  for (const e of entries) {
    entryNameMap.set(getEntryName(e), e.startsWith('./') ? e : `./${e}`);
  }

  for (const result of buildResults) {
    const conditionKey = JSON.stringify(result.activeConditions);

    for (const chunks of Object.values(result.chunks)) {
      for (const chunk of chunks || []) {
        if (chunk.type !== 'chunk') continue;
        const fileName = chunk.fileName;

        // Accept runtime or helper chunks only if explicitly listed as entry (skip non-entry)
        // We only map files whose basename (before any .d.* or extension) matches a known entry name
        const baseMatch = fileName.match(
          /([^/]+?)(?:\.d)?\.(?:m?c?js|[cm]?ts)$/,
        );
        if (!baseMatch) continue;
        const base = baseMatch[1];
        const entryPath = entryNameMap.get(base);
        if (!entryPath) continue;

        const key = `${entryPath}-${conditionKey}`;
        const fullPath = join(result.outDir, fileName).replace(/\\/g, '/');
        const existing = outputFiles.get(key);
        if (existing) existing.files.add(fullPath);
        else
          outputFiles.set(key, {
            entryPath,
            condition: conditionKey,
            files: new Set([fullPath]),
          });
      }
    }
  }

  return outputFiles;
}

interface OutputFileGroup {
  entryPath: string;
  condition: string;
  files: Set<string>;
}

function getEntryName(entryPath: string): string {
  const relativePath = entryPath.replace(/^\.\//, '');
  const withoutExt = relativePath.replace(
    /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/,
    '',
  );
  return withoutExt.split('/').pop() || 'index';
}

function buildExportsField(
  subPathMap: Record<string, string>,
  config: ResolvedConfig,
  outputFiles: Map<string, OutputFileGroup>,
  packageType: string | undefined,
): Record<string, any> {
  const exports: Record<string, any> = {};
  const conditions = config.web.build.conditions;
  const exportTypes = config.web.build.exportTypes === true;

  for (const [subPath, entryPath] of Object.entries(subPathMap)) {
    if (!conditions) {
      const group = findOutputGroup(outputFiles, entryPath, '{}');
      if (group)
        exports[subPath] = createExportEntryFromOutputs(
          outputFiles,
          entryPath,
          '{}',
          packageType,
          exportTypes,
        );
    } else if (Array.isArray(conditions)) {
      exports[subPath] = createSimpleConditionalExportFromOutputs(
        outputFiles,
        entryPath,
        conditions,
        packageType,
        exportTypes,
      );
    } else {
      exports[subPath] = createNestedConditionalExportFromOutputs(
        outputFiles,
        entryPath,
        conditions,
        packageType,
        exportTypes,
      );
    }
  }

  return exports;
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
  exportTypes: boolean,
): Record<string, any> {
  const group = findOutputGroup(outputFiles, entryPath, condition);
  if (!group) return {};

  const dts: string[] = [];
  const mjs: string[] = [];
  const cjs: string[] = [];
  const plainJs: string[] = [];

  for (const f of group.files) {
    // collect type declaration files: .d.ts, .d.mts, .d.cts
    if (/\.d\.(ts|mts|cts)$/.test(f)) dts.push(f);
    else if (f.endsWith('.mjs')) mjs.push(f);
    else if (f.endsWith('.cjs')) cjs.push(f);
    else if (f.endsWith('.js')) plainJs.push(f);
  }

  const toExportPath = (p: string) => (p.startsWith('./') ? p : `./${p}`);
  const resultFlat: Record<string, string> = {};
  let prioritizedDts: string | undefined;
  if (dts.length) {
    dts.sort((a, b) => {
      const rank = (s: string) =>
        s.endsWith('.d.ts')
          ? 0
          : s.endsWith('.d.mts')
            ? 1
            : s.endsWith('.d.cts')
              ? 2
              : 3;
      return rank(a) - rank(b);
    });
    prioritizedDts = toExportPath(dts[0]);
  }
  if (mjs.length) resultFlat.import = toExportPath(mjs[0]);
  if (cjs.length) resultFlat.require = toExportPath(cjs[0]);
  if (!mjs.length && !resultFlat.import && plainJs.length)
    resultFlat.import = toExportPath(plainJs[0]);
  if (!cjs.length && !resultFlat.require && plainJs.length)
    resultFlat.require = toExportPath(plainJs[0]);

  if (exportTypes) {
    const importBranch: Record<string, string> = {};
    const requireBranch: Record<string, string> = {};
    if (resultFlat.import) importBranch.default = resultFlat.import;
    if (resultFlat.require) requireBranch.default = resultFlat.require;
    if (dts.length) {
      const pickTypesForScript = (
        script: string | undefined,
      ): string | undefined => {
        if (!script) return undefined;
        const scriptExtMatch = script.match(/(\.mjs|\.cjs|\.js)$/);
        const scriptExt = scriptExtMatch ? scriptExtMatch[1] : '';
        const root = script.replace(/(\.mjs|\.cjs|\.js)$/, '');
        const rankOrder = (() => {
          if (scriptExt === '.mjs') return ['.d.mts', '.d.ts', '.d.cts'];
          if (scriptExt === '.cjs') return ['.d.cts', '.d.ts', '.d.mts'];
          if (scriptExt === '.js') {
            if (packageType === 'module') return ['.d.ts', '.d.mts', '.d.cts'];
            if (packageType === 'commonjs')
              return ['.d.cts', '.d.ts', '.d.mts'];
          }
          return ['.d.ts', '.d.cts', '.d.mts'];
        })();
        for (const ext of rankOrder) {
          const candidate = root + ext;
          const found = dts.find(
            f =>
              f.endsWith(candidate.replace(/^.*dist\//, ''))
              || f === candidate
              || f.endsWith(candidate),
          );
          if (found) return toExportPath(found);
        }
        return prioritizedDts; // fallback
      };
      const importTypes = pickTypesForScript(importBranch.default);
      const requireTypes = pickTypesForScript(requireBranch.default);
      if (importBranch.default && importTypes) importBranch.types = importTypes;
      if (requireBranch.default && requireTypes)
        requireBranch.types = requireTypes;
    }
    // 需要保证每个层级对象中 types 排在首位。
    // JS 对象的枚举顺序：先是按插入顺序（除去整数键），因此我们在组装时先插入一个带 types 的对象副本，确保顺序。
    function withTypesFirst(obj: Record<string, any>): Record<string, any> {
      if (!obj.types) return obj; // 没有 types 无需处理
      const reordered: Record<string, any> = { types: obj.types };
      for (const k of Object.keys(obj)) {
        if (k === 'types') continue;
        reordered[k] = obj[k];
      }
      return reordered;
    }

    // 先重排 import/require 分支内部顺序
    const importBranchOrdered = withTypesFirst(importBranch);
    const requireBranchOrdered = withTypesFirst(requireBranch);

    const finalExport: Record<string, any> = {};
    if (Object.keys(requireBranchOrdered).length)
      finalExport.require = requireBranchOrdered;
    if (Object.keys(importBranchOrdered).length)
      finalExport.import = importBranchOrdered;
    if (importBranchOrdered.default)
      finalExport.default = withTypesFirst({ ...importBranchOrdered });
    else if (requireBranchOrdered.default)
      finalExport.default = withTypesFirst({ ...requireBranchOrdered });
    return withTypesFirst(finalExport);
  } else {
    // exportTypes 关闭时，不在 exports 中写入 types，由 TS 自行解析
    if (packageType === 'commonjs') {
      if (resultFlat.require) resultFlat.default = resultFlat.require;
      else if (resultFlat.import) resultFlat.default = resultFlat.import;
    } else {
      if (resultFlat.import) resultFlat.default = resultFlat.import;
      else if (resultFlat.require) resultFlat.default = resultFlat.require;
    }
    return resultFlat;
  }
}

function createSimpleConditionalExportFromOutputs(
  outputFiles: Map<string, OutputFileGroup>,
  entryPath: string,
  conditions: string[],
  packageType: string | undefined,
  exportTypes: boolean,
): Record<string, any> {
  const result: Record<string, any> = {};
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
        exportTypes,
      );
    }
  }

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
      exportTypes,
    );
  }

  return result;
}

function createNestedConditionalExportFromOutputs(
  outputFiles: Map<string, OutputFileGroup>,
  entryPath: string,
  conditionGroups: Record<string, string[]>,
  packageType: string | undefined,
  exportTypes: boolean,
): Record<string, any> {
  const groupNames = Object.keys(conditionGroups);
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
        exportTypes,
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

  return buildLevel(0, {});
}

function getLeafExportFollowingAllDefaults(
  rootExport: any,
  conditionGroups: Record<string, string[]>,
): any | undefined {
  if (!rootExport || typeof rootExport !== 'object') return undefined;
  const groupNames = Object.keys(conditionGroups);
  let current = rootExport;
  for (const group of groupNames) {
    const groupConditions = conditionGroups[group];
    if (!groupConditions.includes('default')) return undefined;
    if (!current || typeof current !== 'object') return undefined;
    current = current.default;
  }
  return current && typeof current === 'object' ? current : undefined;
}

async function runPublintCheck(projectRoot: string) {
  try {
    console.log('Running publint check...');
    const { messages, pkg } = await publint({
      pkgDir: projectRoot,
      strict: true,
    });

    if (messages.length > 0) {
      console.error('Publint found issues:');
      let hasError = false;
      for (const message of messages) {
        if (message.type === 'error') {
          hasError = true;
        }
        console.error(`  ${message.type}: ${formatMessage(message, pkg)}`);
      }
      if (hasError) {
        throw new Error(
          `Publint check failed with ${messages.length} issue(s)`,
        );
      }
    }

    console.log('Publint check passed');
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes('Publint check failed')
    ) {
      throw error;
    }
    throw new Error(`Publint check failed: ${error}`);
  }
}

async function runAttwCheck(
  projectRoot: string,
  profile: 'strict' | 'node16' | 'esmOnly' = 'node16',
  level: 'error' | 'warn' = 'error',
) {
  const attwProfiles: Record<string, string[]> = {
    strict: [],
    node16: ['node10'],
    esmOnly: ['node10', 'node16-cjs'],
  };

  try {
    console.log('Running @arethetypeswrong/core check...');

    const tempDir = await mkdtemp(join(tmpdir(), 'utc-attw-'));

    try {
      // Create tarball using npm pack
      const { stdout: tarballInfo } = await promisify(exec)(
        `npm pack --json --pack-destination ${tempDir}`,
        { encoding: 'utf8', cwd: projectRoot },
      );

      const parsed = JSON.parse(tarballInfo);
      if (!Array.isArray(parsed) || !parsed[0]?.filename) {
        throw new Error('Invalid npm pack output format');
      }

      const tarballPath = join(tempDir, parsed[0].filename as string);
      const tarball = await readFile(tarballPath);

      // Create package from tarball data
      const pkg = createPackageFromTarballData(tarball);
      const checkResult = await checkPackage(pkg);

      if (checkResult.types !== false && checkResult.problems) {
        // Filter problems based on profile
        const problems = checkResult.problems.filter(problem => {
          // Only apply profile filter to problems that have resolutionKind
          if ('resolutionKind' in problem) {
            return !attwProfiles[profile]?.includes(problem.resolutionKind);
          }
          // Include all other problem types
          return true;
        });

        if (problems.length > 0) {
          const problemList = problems.map(formatAttwProblem).join('\n');
          const problemMessage = `ATTW found type issues:\n${problemList}`;

          if (level === 'error') {
            throw new Error(problemMessage);
          } else {
            console.warn(problemMessage);
          }
        }
      }

      console.log('ATTW check passed');
    } finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes('ATTW found type issues')
    ) {
      throw error;
    }
    throw new Error(`ATTW check failed: ${error}`);
  }
}

function formatAttwProblem(problem: Problem): string {
  const resolutionKind =
    'resolutionKind' in problem ? ` (${problem.resolutionKind})` : '';
  const entrypoint = 'entrypoint' in problem ? ` at ${problem.entrypoint}` : '';

  switch (problem.kind) {
    case 'NoResolution':
      return `  ❌ No resolution${resolutionKind}${entrypoint}`;

    case 'UntypedResolution':
      return `  ⚠️  Untyped resolution${resolutionKind}${entrypoint}`;

    case 'FalseESM':
      return `  🔄 False ESM: Types indicate ESM (${problem.typesModuleKind}) but implementation is CJS (${problem.implementationModuleKind})\n     Types: ${problem.typesFileName} | Implementation: ${problem.implementationFileName}`;

    case 'FalseCJS':
      return `  🔄 False CJS: Types indicate CJS (${problem.typesModuleKind}) but implementation is ESM (${problem.implementationModuleKind})\n     Types: ${problem.typesFileName} | Implementation: ${problem.implementationFileName}`;

    case 'CJSResolvesToESM':
      return `  ⚡ CJS resolves to ESM${resolutionKind}${entrypoint}`;

    case 'NamedExports': {
      const missingExports =
        problem.missing?.length > 0
          ? ` Missing: ${problem.missing.join(', ')}`
          : '';
      const allMissing = problem.isMissingAllNamed
        ? ' (all named exports missing)'
        : '';
      return `  📤 Named exports problem${allMissing}${missingExports}\n     Types: ${problem.typesFileName} | Implementation: ${problem.implementationFileName}`;
    }

    case 'FallbackCondition':
      return `  🎯 Fallback condition used${resolutionKind}${entrypoint}`;

    case 'FalseExportDefault':
      return `  🎭 False export default\n     Types: ${problem.typesFileName} | Implementation: ${problem.implementationFileName}`;

    case 'MissingExportEquals':
      return `  📝 Missing export equals\n     Types: ${problem.typesFileName} | Implementation: ${problem.implementationFileName}`;

    case 'InternalResolutionError':
      return `  💥 Internal resolution error in ${problem.fileName} (${problem.resolutionOption})\n     Module: ${problem.moduleSpecifier} | Mode: ${problem.resolutionMode}`;

    case 'UnexpectedModuleSyntax':
      return `  📋 Unexpected module syntax in ${problem.fileName}\n     Expected: ${problem.moduleKind} | Found: ${problem.syntax === 99 ? 'ESM' : 'CJS'}`;

    case 'CJSOnlyExportsDefault':
      return `  🏷️  CJS only exports default in ${problem.fileName}`;

    default:
      return `  ❓ Unknown problem: ${JSON.stringify(problem)}`;
  }
}
