import MagicString from 'magic-string';
import { chmod } from 'node:fs/promises';
import path from 'node:path/posix';
import { createUnplugin } from 'unplugin';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function binHelper() {
  return createUnplugin(() => ({
    name: 'utc-bin-helper',

    rolldown: {
      renderChunk(code, chunk, outputOptions) {
        if (!chunk.isEntry || !chunk.facadeModuleId) {
          return;
        }

        const transformed = new MagicString(code);
        transformed.prepend('#!/usr/bin/env node\n');

        return {
          code: transformed.toString(),
          map: outputOptions.sourcemap
            ? transformed.generateMap({ hires: true })
            : undefined,
        };
      },

      async writeBundle(options, bundle) {
        for (const key in bundle) {
          const data = bundle[key];
          if (data.type === 'chunk' && data.isEntry) {
            await chmod(path.join(options.dir!, key), 0o755);
          }
        }
      },
    },
  })).rolldown();
}
