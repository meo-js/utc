import { glob } from '@meojs/cfgs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, relative } from 'path';
import { Project } from 'ts-morph';
import { build, type Options, type TsdownHooks } from 'tsdown';
import { cli } from '../cli.js';
import { resolveConfigFromArgv, type ResolvedConfig } from '../config.js';
import { compileConstant } from '../plugins/compile-constant.js';
import { normalizeMatchPath, resolveGlob } from '../shared.js';

const { scriptExt, scriptExts } = glob;

cli.command(
  'build',
  'Build the project.',
  () => {},
  async args => {
    const config = await resolveConfigFromArgv(args);
    const entry = await getEntry(config);

    const plugin = compileConstant(config);
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
      hooks: {},
      plugins: [plugin],
      inputOptions: {
        // TODO: 从 rolldown 默认值中扩展
        // https://github.com/rolldown/rolldown/blob/main/crates/rolldown_resolver/src/resolver.rs
        // https://github.com/sxzz/dts-resolver/blob/main/src/index.ts
        // https://github.com/sxzz/rolldown-plugin-dts/issues/84
        // exports entrypoint 不应该响应该机制
        resolve: {
          extensionAlias: {
            '.js': [
              '.ios.cocos.js',
              '.ios.js',
              '.js',
              '.ios.cocos.ts',
              '.ios.ts',
              '.ts',
            ],
            '.mjs': [
              '.ios.cocos.mjs',
              '.ios.mjs',
              '.mjs',
              '.ios.cocos.mts',
              '.ios.mts',
              '.mts',
            ],
            '.cjs': [
              '.ios.cocos.cjs',
              '.ios.cjs',
              '.cjs',
              '.ios.cocos.cts',
              '.ios.cts',
              '.cts',
            ],
          },
          extensions: [
            '.ios.cocos.tsx',
            '.ios.cocos.ts',
            '.ios.cocos.jsx',
            '.ios.cocos.js',
            '.ios.cocos.json',
            '.ios.tsx',
            '.ios.ts',
            '.ios.jsx',
            '.ios.js',
            '.ios.json',
            '.tsx',
            '.ts',
            '.jsx',
            '.js',
            '.json',
          ],
        },
      },
      exports: {
        customExports(exports, context) {
          console.log('Custom Exports:', exports, context);
          return exports;
        },
      },
      outputOptions: (options, format, context) => {
        console.log('Output Options:', options, format, context);
      },
      onSuccess(config, signal) {
        console.log('Config:', config);
      },
    };

    // watch
    if (config.web.build.entry == null) {
      (<TsdownHooks>options.hooks)['build:prepare'] = async ctx => {
        console.log(ctx.options.inputOptions);
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
    }

    await build(options);
    await generateCompileConstantDts(config);
  },
);

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
  // 自动收集根模块 (公开模块) 作为入口。
  // 根模块判定依据：存在模块级 JSDoc，包含 @public 与 @module 标记。
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
    // 查找文件级 JSDoc：在顶层第一个 statement 之前的 JSDoc 或直接在文件开头的 JSDoc
    // ts-morph 没有直接的 file jsdoc API，这里遍历语句并收集 pos==0 前的 JSDoc
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
        // 空文件：检查文件全部注释
        const fullText = sourceFile.getFullText();
        const match = fullText.match(/^\/\*\*[\s\S]*?\*\//);
        if (match) moduleCommentBlocks.push(match[0]);
      }
    } catch (e) {
      // 忽略解析异常
    }

    if (!moduleCommentBlocks.length) continue;

    // 简单策略：使用第一块 JSDoc
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

  // 解析 @modulePath
  // 读取文件首个 JSDoc，若包含 @modulePath <subPath>，则使用该子路径。
  // 否则使用默认推断规则。
  // 若子路径重复（指向不同文件）则抛出错误。

  interface ModuleInfo {
    file: string; // 规范化相对 projectRoot 的路径
    custom?: string; // 自定义子路径（含 ./ 或 为 .）
    auto: string; // 自动规则生成的子路径
    final: string; // 最终采用的子路径
  }

  const normalizedFiles = paths.map(v => normalizeMatchPath(v, projectRoot));

  // 建一个临时 ts-morph 项目用于解析注释（不解析类型，无需 tsconfig）
  const project = new Project({
    useInMemoryFileSystem: false,
    skipFileDependencyResolution: true,
  });

  // 计算公共前缀用于自动规则
  let root = '';
  if (normalizedFiles.length === 1) {
    root = projectRoot; // 单文件根直接 projectRoot（自动子路径会成为 '.'）
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

  const customPathSet = new Map<string, string>(); // subPath -> file

  for (const file of normalizedFiles) {
    const absPath = file.startsWith('.')
      ? file.replace(/^\./, projectRoot === '.' ? '' : '')
      : file; // if already absolute keep
    let custom: string | undefined;
    try {
      const sourceFile = project.addSourceFileAtPath(file);
      // 取第一个 statement 的 leading JSDoc
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
          // 规范化：去掉多余引号
          sub = sub.replace(/^['"`]|['"`]$/g, '');
          if (sub === '' || sub === './') sub = '.';
          if (!sub.startsWith('./')) {
            // 允许用户省略开头的 ./ （例如 math -> ./math）
            sub = './' + sub.replace(/^\/+/, '');
          }
          if (sub !== '.' && !sub.startsWith('./')) {
            throw new Error(
              `@modulePath 必须以 ./ 开头或为 '.' (${file} => ${sub})`,
            );
          }
          // 不允许以 / 结尾
          sub = sub.replace(/\/$/, '');
          custom = sub;
        }
      }
    } catch (e) {
      // 忽略解析错误
    }

    const auto = toEntrySubPath(root, file);
    const final = custom ?? auto;

    // 检测冲突：如果已有相同 subPath 但是文件不同
    const existed = customPathSet.get(final);
    if (existed && existed !== file) {
      throw new Error(
        `子路径冲突: '${final}' 同时由 '${existed}' 与 '${file}' 定义。`,
      );
    }
    customPathSet.set(final, file);

    modules.push({ file, custom, auto, final });
  }

  // 如果只有一个模块，但自定义子路径不是 '.'，即可按自定义返回；否则默认 '.'
  const map: Record<string, string> = {};
  for (const m of modules) {
    map[m.final] = m.file;
  }
  return map;
}

export function toEntrySubPath(root: string, path: string) {
  // 生成相对于 root 的入口子路径，移除扩展名。
  // 规则：
  // 1. 计算相对路径；
  // 2. 去掉已知脚本扩展(.ts,.tsx,.js,.mjs,.cjs,.jsx)；
  // 3. 若以 /index 结尾，去掉该 index（保持目录作为入口）；
  // 4. 返回以 ./ 开头；相对路径为空时返回 '.'。

  // 使用 normalizeMatchPath 来获取规范化的相对路径
  let rel = normalizeMatchPath(path, root);

  // 特殊情况：如果结果是 '.'，表示 path 就是 root
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

  // 去掉 trailing /index
  rel = rel.replace(/(^|\/)index$/i, '$1').replace(/\/$/, '');

  if (!rel) return '.';
  return rel.startsWith('.') ? rel : './' + rel;
}
