# Module Organization Standard（mos）

## 规范

- 所有文件会向上查找最近带 `@module` 文件级注释文件

## 可见性

- 文件范围：不使用 `export`
- 公共范围：使用 `export`
- 包范围：使用 `@internal` 注释 `export`

- 所有 index.ts 文件将在 `package.json` 生成 `exports` 入口点，生成的导入路径是相对于 `src` 的路径。


- src
- index.ts
- encoding
 - index.ts
- polyfills.ts
