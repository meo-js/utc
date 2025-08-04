# 编码规范

## 命名

### 代码符号

| 类型 | 命名 | 示范 |
|------|-----|------|
| 类/接口 | PascalCase | `class UserManager` |
| 类型 | PascalCase | `type EventHandler` |
| 枚举 | PascalCase | `enum StatusCode` |
| 枚举成员 | PascalCase | `enum Color { Red, Green, Blue }` |
| 命名空间 | camelCase | `namespace dataUtils` |
| 属性/变量 | camelCase | `let dateTime` |
| 方法/函数 | camelCase | `function getValue` |
| 常量 | CONSTANT_CASE | `const DEBUG` |

### 文件系统

| 类型 | 命名 | 示范 |
|------|-----|------|
| 目录 | kebab-case | `daily-system` |
| 文件 | kebab-case | `home-view.ts` |

### 特别说明

#### 特殊约定

当符号有相似的作用时，统一命名方式：

- `XXXOptions` —— 选项对象。
- `XXXRecord` —— 简单、扁平、不可变的对象，通常代表一个完整、独立的数据结构。

当函数有相似的作用时，统一以一致的前缀命名：

- `use` —— React Hooks 函数。
- `acquire` —— 函数返回的是 `Disposable` 对象。
- `when` —— 函数返回的是 `Observable` 对象。

示例：

```ts
function acquire(): FileHandle;
function acquireSocket(): Socket;
function when(): Observable;
```

当函数有相似的作用时，统一以一致的后缀命名：

- `sync` —— 当同名函数是异步的，用于表示作用相同的同步版本函数。
- `async` —— 当同名函数是同步的，用于表示作用相同的异步版本函数。
- `into` —— 当同名函数是返回一个新对象时，用于表示作用相同但将输出到现有对象的函数。

示例：

```ts
// when async is default.
function write(): string;
function writeSync(): string;

// when sync is default.
function read(): Promise<string>;
function readAsync(): Promise<string>;
```

#### 常见误区

- 禁止增加前/后缀以表明符号的类型：

    - 接口名称不要总是以 `I` 开头。

        > 一个常见的例外是需要与同名类进行区分。

    - 变量名称不要以作用域、类型缩写开头，例如 `mTime`、`gUuid`、`iTime`、`sUuid`。
    - 私有符号不要总是以 `_` 开头。

        > 一个常见的例外是该符号是同名符号的内部实现。

## 符号顺序

本节并非强制性规则，如果对如何排序没有把握则可以适当参考。

对于代码中的任何符号应按照以下基本约定对符号进行排序：

1. 尽量将被引用的符号放在引用它的符号的后面。
2. 将同类型、相关的、作用相似的符号放在一起。
3. 将公共符号放在首位，因为最可能对其感兴趣。

### 模块

在模块中可按下面的类型顺序排序：

1. 枚举
2. 类型
3. 接口
4. 变量
5. 类、函数（视为同一类型）

### 类

在类中可按下面的类型顺序排序：

1. 静态事件
2. 静态变量
3. 静态方法
4. 事件
5. 字段、访问器（视为同一类型）
6. 构造函数
7. 抽象方法
8. 方法

## 注释

- 无论是摘要或是描述，都应统一使用英文，按照完整的句子格式书写；即首字母大写，以句号结尾。
- 单行短语注释可以不使用句号结尾。
- 若出现代码中的标识符，不要改变其大小写。
- 代码、标识符、符号需使用 `{@link symbol}` 而非任何引号包裹，这样能点击链接跳转到定义处，需注意需确保链接的符号已至少作为 `type` 被导入。
- 无法使用 `{@link symbol}` 跳转的符号则使用反引号（\`）包裹，例如 `number`、`string` 等。

### 特殊前缀

在注释中使用以下前缀来提示需要关注的特殊情况或者待办事项：

- `TODO:` - 应尽快完成的待办事项。
- `NOTE:` - 更次要的待办事项，比如暂未实施的想法。
- `FIXME:` - 受限制未能及时修复的问题。
- `HACK:` - 受限制所采取的不规范的行为。

可在冒号前用小括号添加与这条注释有关的额外信息，例如用户名或 Issue 序号：

- `TODO(@smallmain): This is a comment.`
- `TODO(#349): This is a comment.`

### 文档注释

- 使用 JSDoc 与 Markdown 格式编写。
- 每段注释第一行应该是简要描述该代码符号作用的摘要。

```js
/**
 * This is a book.
 * 
 * This book is intended for referencing current coding standards
 * to better improve code maintainability.
 * 
 * @see [Github](https://github.com)
 */
```

#### 标签参考

**接口稳定性**

- @experimental - 实验性接口
- @deprecated - 废弃的
- @since - 接口的可用时间

**可访问性**

- @internal - 内部的
- @public - 公开的

**描述性**

- @param - 描述函数参数
- @returns - 描述函数返回值
- @template - 描述泛型
- @example - 示例代码
- @event - 事件组
- @throws - 抛出错误

**特殊标记**

- @reactive - 响应式对象
- @shallow - 浅层响应式对象
- @val - 响应式值
- @decorator - 装饰器

**文档级标记**

- @module identifier - 模块级别文档，后跟标识符用于推荐导入别名，详情可查看：[ESP SPEC](./ESP_SPEC.md)。
- @link - 用于且仅用于链接到其它代码符号，其余网址、文件链接等使用 Markdown 链接格式。
- @group 用于在文档网站中分类展示。
- @groupDescription 用于在文档网站中显示分类的注释。

## 错误与日志

> 错误与日志一般指给开发者阅读的调试或错误文本，例如 `console.log`、`Error.message`。

- 应统一使用英文，并按照完整的句子格式书写；即首字母大写，以句号结尾。
- 若出现代码中的标识符，不要改变其大小写。
- 代码、标识符需使用反引号（`）而非引号包裹。

### 错误规范

- 每条错误消息的第一行应简明扼要地说明问题所在。
- 如果问题的原因很明确，则尽量同时说明预期的结果和实际的结果，并使用 "must"、"don't"：

    - \`n\` must be a numeric vector, not a character vector.
    - \`n\` must have length 1, not length 2.
    - Don't put the recycled object back into the pool again.

- 如果问题原因并不明确，则使用 "can't"：

    - Can't find column \`b\` in \`.data\`.
    - Can't coerce \`.x\` to a vector.

- 可换行并以 `-` 和空格开头增加子说明，以添加与错误相关的信息或建议，需要注意首字母不要大写，并且以 `tag:` 开头：

    ```
    Can't find file "./a.png".
    - absolute path: "/home/assets/a.png"
    ```

    如果子说明有子项，则用 4 个空格缩进：

    ```
    Can't find file "./a.png".
    - params:
        absolute path: "/home/assets/a.png"
        options: { deep: 1 }
    ```

    `tag` 标签可以是任何字符，但提供解决错误的建议需统一使用标签 `help`：

    ```
    Can't find file "./a.png".
    - help: try to use the `ignoreCase` option.
    ```

    多个建议使用序号列表逐个列出：

    ```
    Can't find file "./a.png".
    - help:
        1. confirm the filename is correct.
        2. try to use the `ignoreCase` option.
    ```

## 泛型

### 默认值

对于泛型类型一般情况下应该要提供默认值，并使默认值保持 “未知”、“任何” 的语义。

以 Class 为例：

```ts
export type Class<
    T extends object = object,
    Arguments extends readonly unknown[] = never,
> = new (...args: Arguments) => T;
```

返回值的默认值设计为 `object`，参数的默认值设计为 `never`，这保证了 `unknwon` 语义。

在 `Meo` 中，统一使用 `uncertain` 类型替代这里的 `never` 类型，能够更好地明确这个意图。

这样当我们需要表示 “未知类” / “任何类” 时，可以避免编写 `Class<unknwon>` 的冗长类型，只需编写 `Class` 即可：

```ts
export function test(v: Class) {
    const instance = new v();
    //               ~~~~~~~~ > Error: ts(2345)
}

test(class { 
    constructor(a: number) {
        console.log("hello");
    }

    method() {
        console.log("world");
    }
});
```

可以看到 `test` 函数可以接收任何 `Class`，符合 “任何” 的语义，但也无法直接调用（因为不知道构造函数需要什么样的参数），符合 “未知” 的语义。

#### 例外情况：`this`

对于 `this` 的默认值则更倾向于使用 `void`，以 `Getter` 为例：

```ts
export type Getter<T = unknown, This = void> = (this: This) => T;
```

原因有两点：

- `this` 是 `void` 的情况更常见，并且更推荐编写纯函数，避免使用 `this`。
- 如果出现需要使用 `this` 为非 `void` 的函数的情况，则无论如何都需显式指定 `this` 的类型。
