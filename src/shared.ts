import { stat } from 'fs/promises';
import { glob } from 'glob';
import { filter } from 'minimatch';
import { isAbsolute, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

export const simpleGitHooksConfigPath = fileURLToPath(
  import.meta.resolve('../assets/simple-git-hooks.json'),
);
export const repoTsconfigTemplatePath = fileURLToPath(
  import.meta.resolve('../assets/repo/tsconfig.json'),
);

export const repoEditorconfigTemplatePath = fileURLToPath(
  import.meta.resolve('../assets/repo/.editorconfig'),
);

export const repoEslintConfigTemplatePath = fileURLToPath(
  import.meta.resolve('../assets/repo/eslint.config.js'),
);

export const repoPrettierConfigTemplatePath = fileURLToPath(
  import.meta.resolve('../assets/repo/prettier.config.js'),
);

export const repoStylelintConfigTemplatePath = fileURLToPath(
  import.meta.resolve('../assets/repo/stylelint.config.js'),
);

export const repoVitestConfigTemplatePath = fileURLToPath(
  import.meta.resolve('../assets/repo/vitest.config.js'),
);

export async function filterFiles(
  files: string[],
  patterns: string[],
  filters: string[],
  projectPath: string,
): Promise<string[]> {
  // 规范化模式，相对路径以 projectPath 为基准
  const normalizedPatterns = await normalizeGlob(patterns, '*', projectPath);
  const normalizedFilters = await normalizeGlob(filters, '*', projectPath);

  return files.filter(absFile => {
    // 转成相对路径（若在 project 内），并统一分隔符为 posix 方便与 glob/match 模式兼容
    const rel = normalizeMatchPath(absFile, projectPath);
    const matchTargetCandidates = [absFile, rel];

    // 所有 pattern (inclusive set) 都需要匹配（原语义保持）
    const passPatterns = normalizedPatterns.every(p =>
      matchTargetCandidates.some(t =>
        filter(p, { dot: true, matchBase: true })(t),
      ),
    );
    if (!passPatterns) return false;

    // 过滤器（进一步收窄）
    const passFilters = normalizedFilters.every(p =>
      matchTargetCandidates.some(t => filter(p, { dot: true })(t)),
    );
    return passFilters;
  });
}

export async function resolveGlob(
  patterns: string[],
  projectPath: string,
  extPattern: string,
): Promise<string[]> {
  const allFiles = new Set<string>();
  for (const pattern of await normalizeGlob(
    patterns,
    extPattern,
    projectPath,
  )) {
    const files = await glob(pattern, {
      cwd: projectPath,
      absolute: true,
      nodir: true,
    });
    files
      .filter(filter(`*.${extPattern}`, { dot: true, matchBase: true }))
      .forEach(file => allFiles.add(file));
  }
  return [...allFiles];
}

export async function normalizeGlob(
  patterns: string[],
  extPattern: string,
  basePath?: string,
) {
  // 可能传入目录，则转为 glob patterns
  // 文件必须带扩展名，否则不存在时会被认为是目录
  const normalized: string[] = [];
  for (const pattern of patterns) {
    let isGlob = false;
    let isDirectory = false;
    let isFile = false;

    const absPattern = toAbsoluteIfBase(pattern, basePath);

    try {
      if (isGlobPattern(pattern)) {
        isGlob = true;
      } else {
        const stats = await stat(absPattern);
        isDirectory = stats.isDirectory();
        isFile = stats.isFile();
      }
    } catch (error) {}

    const dirPattern = ensureRelative(pattern, basePath);

    if (isDirectory) {
      normalized.push(`${dirPattern.replace(/\\/g, '/')}/**/*.${extPattern}`);
    } else {
      normalized.push(ensureRelative(pattern, basePath).replace(/\\/g, '/'));
    }
  }
  return normalized;
}

function toAbsoluteIfBase(pattern: string, basePath?: string) {
  if (!basePath) return pattern;
  if (isAbsolute(pattern)) return pattern;
  return join(basePath, pattern);
}

export function ensureRelative(pattern: string, basePath?: string) {
  if (!basePath) return pattern;
  if (!isAbsolute(pattern)) return pattern;
  const rel = relative(basePath, pattern) || '.';
  return rel.split(sep).join('/');
}

export function normalizeMatchPath(filePath: string, basePath: string) {
  let rel = relative(basePath, filePath);
  if (rel === '') rel = '.';
  if (rel.startsWith('..')) {
    return filePath.split(sep).join('/');
  } else {
    return rel.split(sep).join('/');
  }
}

export function isGlobPattern(pattern: string): boolean {
  // 以 ! 开头的否定模式
  if (pattern.startsWith('!')) return true;

  // 匹配未被反斜线转义的通配符：*, ?, [...], {...}, 以及 extglob：!(), +(), ?(), *(), @()
  const globLikeRE = /(^|[^\\])(?:[*?]|\[[^\]]+\]|\{[^}]+\}|[!@+?*]\([^)]*\))/;
  return globLikeRE.test(pattern);
}

export function initializeActiveConditions(
  activeConditionsConfig?: string[] | Record<string, string>,
) {
  const conditions = activeConditionsConfig ?? {};
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
  return activeConditions;
}

export function buildResolveConfig(
  activeConditions: Record<string, string | boolean>,
) {
  const conditionEntries = Object.entries(activeConditions).filter(
    ([, v]) => v !== false && v != null && v !== '',
  );

  const segments: string[] = [];
  for (const [key, value] of conditionEntries) {
    if (typeof value === 'boolean') {
      if (value) segments.push(key); // 使用键名
    } else if (typeof value === 'string') {
      segments.push(value);
    }
  }

  if (segments.length === 0) {
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

  return { extensionAlias, extensions, conditionNames: [...segments, '...'] };
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

export function conditionsToPlatform(
  conditions: string[],
  defaultValue: 'node' | 'browser' | 'neutral',
): 'node' | 'browser' | 'neutral' {
  const hasNode = conditions.includes('node');
  const hasBrowser = conditions.includes('browser');

  return (hasNode && hasBrowser) || (!hasNode && !hasBrowser)
    ? defaultValue
    : hasNode
      ? 'node'
      : 'browser';
}
