import { createUnplugin } from 'unplugin';
import type { ResolvedConfig } from '../config.js';

export function compileConstant(config: ResolvedConfig, activeConditions: Record<string, string | boolean> = {}) {
  const conditions = config.web.build.conditions;

  const virtualModules = new Map<string, string>();
  const resolvedIds = new Set<string>();
  const virtualIdPrefix = '\0compile-constant';

  if (conditions) {
    if (Array.isArray(conditions)) {
      const id = 'compile-constant';
      const constants = Object.fromEntries(
        conditions.map(c => [toUpper(c), Boolean(activeConditions[c])]),
      );
      const code = Object.entries(constants)
        .map(([k, v]) => `export const ${k} = ${v};`)
        .join('\n');

      resolvedIds.add(id);
      virtualModules.set(virtualIdPrefix, code);
    } else {
      for (const [group, list] of Object.entries(conditions)) {
        const id = `compile-constant/${group}`;
        const activeCondition = activeConditions[group];
        const constants = Object.fromEntries(
          list.map(c => [toUpper(c), c === activeCondition]),
        );
        const code = Object.entries(constants)
          .map(([k, v]) => `export const ${k} = ${v};`)
          .join('\n');

        resolvedIds.add(id);
        virtualModules.set(`\0${id}`, code);
      }
    }
  }

  return createUnplugin(() => {
    return {
      name: 'utc-compile-constant',
      enforce: 'pre',
      resolveId(id: string) {
        if (resolvedIds.has(id)) return '\0' + id;
        return null;
      },
      load(id: string) {
        return virtualModules.get(id) || null;
      },
    };
  }).rolldown();
}

function toUpper(s: string) {
  return s.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
}
