import { stat } from 'fs/promises';
import { glob } from 'glob';
import { filter } from 'minimatch';
import { isAbsolute, join, relative, sep } from 'path';

export const simpleGitHooksConfigPath = new URL(
  import.meta.resolve('../assets/simple-git-hooks.json'),
).pathname;

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
      matchTargetCandidates.some(t => filter(p, { dot: true })(t)),
    );
    if (!passPatterns) return false;

    // 过滤器（进一步收窄）
    const passFilters = normalizedFilters.every(p =>
      matchTargetCandidates.some(t =>
        filter(p, { dot: true, matchBase: true })(t),
      ),
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
      .filter(filter(extPattern, { dot: true, matchBase: true }))
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
