import { glob } from '@meojs/cfgs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { Project } from 'ts-morph';
import { build, type Options, type TsdownHooks } from 'tsdown';
import { cli } from '../cli.js';
import { resolveConfigFromArgv, type ResolvedConfig } from '../config.js';
import { compileConstant } from '../plugins/compile-constant.js';
import {
  finalizePackageExports,
  initializePackageExportsState,
  markConditionComplete,
  packageExports,
} from '../plugins/package-exports.js';
import { normalizeMatchPath, resolveGlob } from '../shared.js';

const { scriptExt, scriptExts } = glob;

cli.command(
  'build',
  'Build the project.',
  () => {},
  async args => {
    const config = await resolveConfigFromArgv(args);

    const conditionCombinations = getConditionCombinations(
      config.web.build.conditions,
    );

    try {
      await rm(join(config.project, 'dist'), { recursive: true });
    } catch (error) {}

    // 初始化 packageExports 状态
    const needExports = config.web.build.exports;
    if (needExports) {
      initializePackageExportsState(config.project);
    }

    const entry = await getEntry(config);

    if (conditionCombinations.length === 0) {
      await buildSingle(config, {});
      if (needExports) {
        markConditionComplete(config.project, {});
      }
    } else {
      for (const combination of conditionCombinations) {
        await buildSingle(config, combination);
        if (needExports) {
          markConditionComplete(config.project, combination);
        }
      }
    }

    // 最终生成 package.json exports
    if (needExports) {
      await finalizePackageExports(
        config.project,
        Array.isArray(entry) ? entry : [entry],
        config,
      );
    }

    await generateCompileConstantDts(config);
  },
);

function getConditionCombinations(
  conditions: string[] | Record<string, string[]> | undefined,
) {
  if (!conditions) return [];

  if (Array.isArray(conditions)) {
    return conditions.map(condition => ({ [condition]: true }));
  }

  const groups = Object.entries(conditions);
  if (groups.length === 0) return [];

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

async function buildSingle(
  config: ResolvedConfig,
  activeConditions: Record<string, string | boolean>,
) {
  const entry = await getEntry(config);
  const outDirSuffix = generateOutDirSuffix(activeConditions);

  const outDir = outDirSuffix ? `dist/${outDirSuffix}` : 'dist';

  const options: Options = {
    cwd: config.project,
    entry,
    sourcemap: true,
    dts: true,
    treeshake: true,
    target: 'esnext',
    platform: 'neutral',
    unbundle: true,
    format: ['esm', 'cjs'],
    outDir,
    hooks: {},
    plugins: [
      compileConstant(config, activeConditions),
      packageExports(config, activeConditions, entry, outDir),
    ],
    inputOptions: {
      resolve: buildResolveConfig(activeConditions),
    },
  };

  if (config.web.build.entry == null) {
    (<TsdownHooks>options.hooks)['build:prepare'] = async ctx => {
      ctx.options.entry = await getEntry(config);
    };
  }

  if (config.web.build.strict) {
    options.publint = {
      strict: true,
    };
    options.attw = {
      level: 'error',
    };
    options.unused = true;
  }

  await build(options);
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

function buildResolveConfig(
  activeConditions: Record<string, string | boolean>,
) {
  const conditionEntries = Object.entries(activeConditions).filter(
    ([, v]) => v !== false && v != null && v !== '',
  );

  // 收集段（条件后缀的每一部分）
  const segments: string[] = [];
  for (const [key, value] of conditionEntries) {
    if (typeof value === 'boolean') {
      if (value) segments.push(key); // 使用键名
    } else if (typeof value === 'string') {
      segments.push(value);
    }
  }

  if (segments.length === 0) {
    // 无条件，回退到默认解析
    return {
      extensionAlias: {
        '.js': ['.js', '.ts'],
        '.mjs': ['.mjs', '.mts'],
        '.cjs': ['.cjs', '.cts'],
        '.jsx': ['.jsx', '.tsx'],
        '.mjsx': ['.mjsx', '.mtsx'],
        '.cjsx': ['.cjsx', '.ctsx'],
      },
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    };
  }

  // 生成后缀 (.a.b, .b.a, .a, .b ...)
  const suffixes: string[] = [];
  const seen = new Set<string>();
  for (let len = segments.length; len > 0; len--) {
    for (const perm of getPermutations(segments, len)) {
      const suffix = '.' + perm.join('.');
      if (!seen.has(suffix)) {
        seen.add(suffix);
        suffixes.push(suffix);
      }
    }
  }

  // 构造 extensionAlias (优先最具体)
  const extensionAlias: Record<string, string[]> = {};
  const extensions: string[] = [];

  const baseMap: Record<string, { ts: string }> = {
    js: { ts: 'ts' },
    mjs: { ts: 'mts' },
    cjs: { ts: 'cts' },
    jsx: { ts: 'tsx' },
    mjsx: { ts: 'mtsx' },
    cjsx: { ts: 'ctsx' },
  };

  for (const baseExt of Object.keys(baseMap)) {
    const aliases: string[] = [];
    for (const s of suffixes) {
      aliases.push(
        `${s}.${baseExt}`,
        `${s}.${baseMap[baseExt as keyof typeof baseMap].ts}`,
      );
    }
    // 回退原始
    aliases.push(
      `.${baseExt}`,
      `.${baseMap[baseExt as keyof typeof baseMap].ts}`,
    );
    extensionAlias[`.${baseExt}`] = aliases;
  }

  for (const s of suffixes) {
    extensions.push(`${s}.tsx`, `${s}.ts`, `${s}.jsx`, `${s}.js`, `${s}.json`);
  }
  extensions.push('.tsx', '.ts', '.jsx', '.js', '.json');

  return { extensionAlias, extensions };
}

function getPermutations<T>(arr: T[], length: number): T[][] {
  if (length === 1) return arr.map(item => [item]);

  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    const perms = getPermutations(rest, length - 1);
    for (const perm of perms) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
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

async function getEntry(config: ResolvedConfig) {
  if (config.web.build.entry) {
    return config.web.build.entry;
  } else {
    return await getAllRootModules(config);
  }
}

async function getAllRootModules(config: ResolvedConfig): Promise<string[]> {
  const projectRoot = config.project;
  const sourceGlobs = config.web.source;

  const files = await resolveGlob(sourceGlobs, projectRoot, `*.${scriptExt}`);

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
    } catch (e) {
      // 忽略解析异常
    }

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
    root = projectRoot;
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
    } catch (e) {
      // 忽略解析错误
    }

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
