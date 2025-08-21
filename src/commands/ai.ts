import { spawn } from 'child_process';
import {
  access,
  appendFile,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'fs/promises';
import { extname, join, relative, resolve } from 'path';

interface ProcessResult {
  file: string;
  success: boolean;
  result: string;
  error?: string;
  duration: number;
  cost: number;
}

interface ClaudeCodeResult {
  content: string;
  cost: number;
  duration: number;
  numTurns: number;
}

interface ClaudeMessage {
  type: string;
  message?: unknown;
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

interface ParsedArgs {
  help?: boolean;
  path?: string;
  config?: string;
  filter?: string;
  threads?: number;
}

/**
 * 分析和增强错误信息
 */
function analyzeError(error: Error, context: string): string {
  let enhancedMessage = error.message;

  // 添加上下文信息
  enhancedMessage = `${context}: ${enhancedMessage}`;

  return enhancedMessage;
}

class AIProcessor {
  private processedFiles = new Set<string>();
  private processedFilesPath = './ai-files.txt';
  private resultPath = './ai-result.md';
  private logPath = './ai-logs.txt';
  private results: ProcessResult[] = [];
  private fileFilterRegex?: RegExp;
  private concurrency: number;

  constructor(
    private promptFile: string,
    private targetPath: string,
    filterPattern?: string,
    threads = 1,
  ) {
    this.concurrency = threads;
    if (filterPattern !== undefined && filterPattern !== '') {
      this.fileFilterRegex = new RegExp(filterPattern, 'iu');
    }
  }

  async init(): Promise<void> {
    // 检查 Claude CLI 是否可用
    try {
      await this.checkClaudeCliAvailable();
    } catch (error) {
      console.error('❌ Claude CLI 不可用:', error);
      console.error(
        '请确保已安装 Claude Code CLI: npm install -g @anthropic-ai/claude-code',
      );
      console.error('或者在项目中安装: npm install @anthropic-ai/claude-code');
      console.error('并设置环境变量 ANTHROPIC_API_KEY');
      throw error;
    }

    // 读取已处理的文件列表
    try {
      await access(this.processedFilesPath);
      const content = await readFile(this.processedFilesPath, 'utf-8');
      this.processedFiles = new Set(content.trim().split('\n').filter(Boolean));
      console.log(`📁 已加载 ${this.processedFiles.size} 个已处理文件`);
    } catch {
      console.log('📁 未找到已处理文件记录，从头开始');
    }

    // 初始化日志文件
    await this.initLogFile();
  }

  private async initLogFile(): Promise<void> {
    const logHeader = `=== AI 处理日志 ===
生成时间: ${new Date().toLocaleString()}
进程ID: ${process.pid}
工作目录: ${process.cwd()}
配置文件: ${this.promptFile}
目标路径: ${this.targetPath}
并发数: ${this.concurrency}
过滤器: ${this.fileFilterRegex?.toString() ?? '无'}

=====================================

`;
    await writeFile(this.logPath, logHeader);
  }

  private async logToFile(content: string): Promise<void> {
    try {
      await appendFile(this.logPath, content);
    } catch (error) {
      console.error('写入日志文件失败:', error);
    }
  }

  private logToFileAsync(content: string): void {
    this.logToFile(content).catch((error: unknown) => {
      console.error('写入日志失败:', error);
    });
  }

  private async checkClaudeCliAvailable(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['claude', '--version']);

      let hasOutput = false;
      child.stdout.on('data', () => {
        hasOutput = true;
      });

      child.stderr.on('data', () => {
        hasOutput = true;
      });

      child.on('close', code => {
        if (code === 0 || hasOutput) {
          resolve();
        } else {
          reject(new Error('Claude CLI 未找到或无法运行'));
        }
      });

      child.on('error', error => {
        reject(error);
      });
    });
  }

  async getFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = [];
    const codeExtensions = [
      '.ts',
      '.js',
      '.tsx',
      '.jsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.h',
      '.hpp',
      '.cs',
      '.php',
      '.rb',
      '.go',
      '.rs',
      '.kt',
      '.swift',
      '.dart',
      '.scala',
      '.clj',
      '.hs',
      '.ml',
      '.fs',
      '.vb',
      '.sql',
      '.sh',
      '.bash',
      '.zsh',
      '.json',
      '.yaml',
      '.yml',
      '.xml',
      '.html',
      '.css',
      '.scss',
      '.sass',
      '.less',
      '.md',
      '.mdx',
      '.vue',
      '.svelte',
    ];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // 跳过常见的构建和依赖目录
          if (
            ![
              'node_modules',
              'dist',
              'build',
              '.git',
              'coverage',
              '.next',
              '.nuxt',
              'target',
            ].includes(entry.name)
          ) {
            files.push(...(await this.getFilesRecursively(fullPath)));
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (codeExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`无法读取目录 ${dir}: ${String(error)}`);
    }

    return files;
  }

  async getTargetFiles(): Promise<string[]> {
    try {
      const fileStat = await stat(this.targetPath);

      if (fileStat.isFile()) {
        const files = [resolve(this.targetPath)];
        return this.filterFiles(files);
      } else if (fileStat.isDirectory()) {
        const files = await this.getFilesRecursively(this.targetPath);
        const resolvedFiles = files.map(f => resolve(f)).sort();
        return this.filterFiles(resolvedFiles);
      } else {
        throw new Error('目标路径既不是文件也不是目录');
      }
    } catch (error) {
      throw new Error(`无法访问目标路径 ${this.targetPath}: ${String(error)}`);
    }
  }

  private filterFiles(files: string[]): string[] {
    if (this.fileFilterRegex === undefined) {
      return files;
    }
    return files.filter(file => this.fileFilterRegex?.test(file) !== true);
  }

  private async runClaudeCode(
    promptFilePath: string,
    codeFilePath: string,
    fileName: string,
  ): Promise<ClaudeCodeResult> {
    // 生成简单的指令，让 Claude Code 读取指定的文件
    const instruction = `请按照提示文件处理该代码文件：
- 提示文件路径：${promptFilePath}
- 代码文件路径：${codeFilePath}`;

    // 记录 Claude CLI 调用信息
    await this.logToFile(`  启动 Claude CLI 处理...\n`);
    await this.logToFile(`  指令: ${instruction}\n`);

    return new Promise((resolve, reject) => {
      const claude = spawn(
        'npx',
        [
          'claude',
          '-p',
          instruction,
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          'acceptEdits',
        ],
        {
          stdio: ['inherit', 'pipe', 'pipe'],
          env: {
            ...process.env,
          },
        },
      );

      let outputBuffer = '';
      let errorBuffer = '';
      let currentTokenCount = 0;
      let lastTokenUpdate = Date.now();
      let isProcessing = false;

      claude.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        outputBuffer += chunk;

        // 记录原始输出到日志
        this.logToFileAsync(`  [STDOUT] ${chunk}`);

        // 分析流式输出中的 token 信息
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line.trim()) as ClaudeMessage;

              // 检查不同类型的消息
              if (message.type === 'system' && !isProcessing) {
                isProcessing = true;
                process.stdout.write(`\r   🚀 ${fileName} - 开始处理...\n`);
                this.logToFileAsync(`  系统消息: 开始处理\n`);
              } else if (message.type === 'assistant' && message.message) {
                // 估算 token 数（基于内容长度的粗略估算）
                const content = JSON.stringify(message.message);
                const estimatedTokens = Math.floor(content.length / 4);
                currentTokenCount += estimatedTokens;

                // 每隔一段时间更新 token 数显示
                const now = Date.now();
                if (now - lastTokenUpdate > 500) {
                  // 每0.5秒更新一次
                  const elapsed = Math.floor((now - lastTokenUpdate) / 1000);
                  process.stdout.write(
                    `\r   📊 ${fileName} - 已处理 ~${currentTokenCount} tokens (${elapsed}s)...`,
                  );
                  this.logToFileAsync(
                    `  进度更新: ${currentTokenCount} tokens (${elapsed}s)\n`,
                  );
                  lastTokenUpdate = now;
                }
              } else if (message.type === 'user') {
                process.stdout.write(`\r   💭 ${fileName} - 用户交互中...\n`);
                this.logToFileAsync(`  用户交互消息\n`);
              }
            } catch {
              // 忽略解析错误，继续处理
            }
          }
        }
      });

      claude.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        errorBuffer += chunk;

        // 记录错误输出到日志
        this.logToFileAsync(`  [STDERR] ${chunk}`);

        // 检查是否包含有用的进度信息
        if (
          chunk.includes('token')
          || chunk.includes('processing')
          || chunk.includes('API')
        ) {
          process.stdout.write(`\r   🔄 ${fileName} - ${chunk.trim()}\n`);
        } else if (chunk.trim()) {
          // 如果不是进度信息，可能是错误信息
          console.error(`\r   ⚠️ ${fileName} - ${chunk.trim()}`);
        }
      });

      claude.on('close', code => {
        // 清除实时状态显示
        process.stdout.write(`\r   \n`);

        // 记录进程关闭信息
        this.logToFileAsync(`  Claude CLI 进程关闭，退出码: ${code}\n`);

        if (code !== 0) {
          let errorMsg = `Claude process exited with code ${code}`;

          // 根据退出码提供更具体的错误信息
          switch (code) {
            case 1:
              errorMsg += ' (一般错误)';
              break;
            case 2:
              errorMsg += ' (参数错误)';
              break;
            case 126:
              errorMsg += ' (命令不可执行)';
              break;
            case 127:
              errorMsg += ' (命令未找到)';
              break;
            case 128:
              errorMsg += ' (无效的退出参数)';
              break;
            case 130:
              errorMsg += ' (被 Ctrl+C 中断)';
              break;
            default:
              errorMsg += ` (未知错误码)`;
          }

          // 如果有错误输出，添加到错误信息中
          if (errorBuffer.trim()) {
            errorMsg += `\n\n错误输出:\n${errorBuffer.trim()}`;
          }

          // 尝试从输出缓冲区中找到错误信息
          const lines = outputBuffer.split('\n');
          const errorLines = lines.filter(line => {
            const lower = line.toLowerCase();
            return (
              lower.includes('error')
              || lower.includes('exception')
              || lower.includes('failed')
              || lower.includes('timeout')
              || lower.includes('invalid')
              || lower.includes('unauthorized')
              || lower.includes('forbidden')
              || lower.includes('not found')
            );
          });

          if (errorLines.length > 0) {
            errorMsg += `\n\n输出中的错误信息:\n${errorLines.slice(0, 5).join('\n')}`;
            if (errorLines.length > 5) {
              errorMsg += `\n... 还有 ${errorLines.length - 5} 行错误信息`;
            }
          }

          // 添加调试信息
          if (outputBuffer.trim()) {
            const truncatedOutput =
              outputBuffer.length > 1000
                ? `${outputBuffer.substring(0, 1000)}...\n[输出被截断，总长度: ${outputBuffer.length}]`
                : outputBuffer;
            errorMsg += `\n\n完整输出:\n${truncatedOutput}`;
          }

          // 记录完整错误信息到日志
          this.logToFileAsync(`  完整错误信息: ${errorMsg}\n`);

          reject(new Error(errorMsg));
          return;
        }

        try {
          // 解析所有消息
          const messages = outputBuffer
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              try {
                return JSON.parse(line.trim()) as ClaudeMessage;
              } catch {
                return null;
              }
            })
            .filter((msg): msg is ClaudeMessage => msg !== null);

          // 查找结果消息
          const resultMessage = messages.find(msg => msg.type === 'result');
          if (!resultMessage) {
            const errorMsg = '未找到结果消息';
            this.logToFileAsync(`  错误: ${errorMsg}\n`);
            reject(new Error(errorMsg));
            return;
          }

          // 显示最终统计信息
          const finalTokens = currentTokenCount;
          const cost = resultMessage.total_cost_usd ?? 0;
          const turns = resultMessage.num_turns ?? 0;

          console.log(
            `   📈 ${fileName} - 处理完成: ${finalTokens} tokens, ${turns} turns, $${cost.toFixed(6)}`,
          );

          // 记录最终结果到日志
          this.logToFileAsync(
            `  处理完成统计: ${finalTokens} tokens, ${turns} turns, $${cost.toFixed(6)}\n`,
          );

          resolve({
            content: resultMessage.result ?? '',
            cost: cost,
            duration: resultMessage.duration_ms ?? 0,
            numTurns: turns,
          });
        } catch (error) {
          const errorMsg = `解析输出失败: ${String(error)}`;
          this.logToFileAsync(`  解析错误: ${errorMsg}\n`);
          reject(new Error(errorMsg));
        }
      });

      claude.on('error', error => {
        const enhancedErrorMessage = analyzeError(
          error,
          `Claude 进程启动失败 (${fileName})`,
        );

        // 记录进程启动错误到日志
        this.logToFileAsync(`  进程启动错误: ${enhancedErrorMessage}\n`);

        // 如果有错误输出，也添加进来
        if (errorBuffer.trim()) {
          const finalMessage = `${enhancedErrorMessage}\n\n进程错误输出:\n${errorBuffer.trim()}`;
          this.logToFileAsync(`  进程错误输出: ${errorBuffer.trim()}\n`);
          reject(new Error(finalMessage));
        } else {
          reject(new Error(enhancedErrorMessage));
        }
      });
    });
  }

  async processFile(
    filePath: string,
    promptFilePath: string,
  ): Promise<ProcessResult> {
    const relativePath = relative(process.cwd(), filePath);
    let attemptCount = 0;
    let totalDuration = 0;
    let totalCost = 0;
    // const startTime = Date.now();

    // 记录开始处理日志
    await this.logToFile(
      `\n[${new Date().toISOString()}] 开始处理文件: ${relativePath}\n`,
    );
    await this.logToFile(`  文件路径: ${filePath}\n`);
    await this.logToFile(`  提示文件: ${promptFilePath}\n`);

    while (true) {
      attemptCount++;
      const attemptStartTime = Date.now();

      if (attemptCount === 1) {
        console.log(`\n🔄 正在处理: ${relativePath}`);
        await this.logToFile(`  第 ${attemptCount} 次尝试开始\n`);
      } else {
        console.log(
          `\n🔄 重试处理: ${relativePath} (第 ${attemptCount} 次尝试)`,
        );
        await this.logToFile(`  第 ${attemptCount} 次尝试开始 (重试)\n`);
      }

      try {
        // 读取文件内容以获取文件大小信息
        const fileContent = await readFile(filePath, 'utf-8');
        const fileSize = fileContent.length;
        const estimatedInputTokens = Math.floor(fileSize / 4);

        console.log(
          `   📄 文件大小: ${fileSize} 字符 (~${estimatedInputTokens} tokens)`,
        );
        await this.logToFile(
          `  文件大小: ${fileSize} 字符 (~${estimatedInputTokens} tokens)\n`,
        );

        // 使用 Claude Code CLI 处理，传入文件路径而不是文件内容
        const result = await this.runClaudeCode(
          promptFilePath,
          filePath,
          relativePath,
        );

        const duration = Date.now() - attemptStartTime;
        totalDuration += duration;
        totalCost += result.cost;

        // 记录成功处理的详细日志
        await this.logToFile(`  处理成功!\n`);
        await this.logToFile(`  耗时: ${duration}ms\n`);
        await this.logToFile(`  Token 数: ${result.numTurns} turns\n`);
        await this.logToFile(`  成本: $${result.cost.toFixed(6)}\n`);
        await this.logToFile(`  输出长度: ${result.content.length} 字符\n`);
        await this.logToFile(`  总尝试次数: ${attemptCount}\n`);
        await this.logToFile(`  总耗时: ${totalDuration}ms\n`);
        await this.logToFile(`  总成本: $${totalCost.toFixed(6)}\n`);

        // 记录处理结果的前500字符作为样本
        const sampleContent =
          result.content.length > 500
            ? `${result.content.substring(0, 500)}...`
            : result.content;
        await this.logToFile(`  处理结果样本:\n${sampleContent}\n`);
        await this.logToFile(`  --- 结束处理 ---\n\n`);

        // 记录已处理文件
        await appendFile(this.processedFilesPath, `${relativePath}\n`);
        this.processedFiles.add(relativePath);

        const retryInfo =
          attemptCount > 1 ? ` (经过 ${attemptCount} 次尝试)` : '';
        console.log(
          `✅ 完成处理: ${relativePath} (${duration}ms, ${result.numTurns} turns, $${result.cost.toFixed(6)})${retryInfo}`,
        );

        return {
          file: relativePath,
          success: true,
          result: result.content,
          duration: totalDuration,
          cost: totalCost,
        };
      } catch (error) {
        const duration = Date.now() - attemptStartTime;
        totalDuration += duration;

        const processedError =
          error instanceof Error ? error : new Error(String(error));

        const enhancedErrorMessage = analyzeError(
          processedError,
          `处理文件 ${relativePath} 第 ${attemptCount} 次尝试`,
        );

        // 记录详细的错误日志
        await this.logToFile(`  第 ${attemptCount} 次尝试失败!\n`);
        await this.logToFile(`  错误信息: ${enhancedErrorMessage}\n`);
        await this.logToFile(`  耗时: ${duration}ms\n`);

        if (processedError.stack !== undefined && processedError.stack !== '') {
          await this.logToFile(`  错误堆栈:\n${processedError.stack}\n`);
        }

        console.error(
          `❌ 处理失败: ${relativePath} - 第 ${attemptCount} 次尝试`,
        );
        console.error(`   ${enhancedErrorMessage}`);

        if (processedError.stack !== undefined && processedError.stack !== '') {
          console.error(`   错误堆栈:`);
          console.error(
            processedError.stack
              .split('\n')
              .map((line: string) => `     ${line}`)
              .join('\n'),
          );
        }

        // 等待一段时间后重试（递增等待时间）
        const waitTime = Math.min(1000 * Math.pow(2, attemptCount - 1), 30000); // 最多等待30秒
        console.log(`   ⏳ 等待 ${waitTime}ms 后重试...`);
        await this.logToFile(`  等待 ${waitTime}ms 后重试...\n`);

        await new Promise<void>(resolve => {
          setTimeout(() => resolve(), waitTime);
        });
      }
    }
  }

  async generateResultFile(): Promise<void> {
    const successCount = this.results.filter(r => r.success).length;
    const failCount = this.results.filter(r => !r.success).length;
    const totalCost = this.results.reduce((sum, r) => sum + r.cost, 0);
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    let markdown = `# AI 处理结果报告\n\n`;
    markdown += `**生成时间:** ${new Date().toLocaleString()}\n\n`;
    markdown += `## 📊 统计信息\n\n`;
    markdown += `- **总文件数:** ${this.results.length}\n`;
    markdown += `- **成功处理:** ${successCount}\n`;
    markdown += `- **处理失败:** ${failCount}\n`;
    markdown += `- **总耗时:** ${(totalDuration / 1000).toFixed(2)}s\n`;
    markdown += `- **总成本:** $${totalCost.toFixed(6)}\n\n`;

    if (failCount > 0) {
      markdown += `## ❌ 失败文件\n\n`;
      for (const result of this.results.filter(r => !r.success)) {
        markdown += `### ${result.file}\n\n`;
        markdown += `**错误信息:** ${result.error ?? '未知错误'}\n\n`;
        markdown += `**耗时:** ${result.duration}ms\n\n`;
        markdown += `---\n\n`;
      }
    }

    markdown += `## ✅ 成功处理的文件\n\n`;
    for (const result of this.results.filter(r => r.success)) {
      markdown += `### ${result.file}\n\n`;
      markdown += `**耗时:** ${result.duration}ms | **成本:** $${result.cost.toFixed(6)}\n\n`;
      markdown += `**处理结果:**\n\n`;
      markdown += `${result.result}\n\n`;
      markdown += `---\n\n`;
    }

    await writeFile(this.resultPath, markdown);
    console.log(`📄 结果报告已保存至: ${this.resultPath}`);
  }

  async run(): Promise<void> {
    try {
      await this.init();

      const targetFiles = await this.getTargetFiles();

      console.log(`🎯 找到 ${targetFiles.length} 个文件`);

      // 过滤已处理的文件
      const unprocessedFiles = targetFiles.filter(file => {
        const relativePath = relative(process.cwd(), file);
        return !this.processedFiles.has(relativePath);
      });

      console.log(`📋 需要处理 ${unprocessedFiles.length} 个文件`);

      if (unprocessedFiles.length === 0) {
        console.log('✨ 所有文件都已处理完成');
        return;
      }

      console.log(`🔄 使用 ${this.concurrency} 个并发线程处理`);

      // 并发处理文件
      const results = await this.processFilesWithConcurrency(
        unprocessedFiles,
        this.promptFile,
      );
      this.results.push(...results);

      await this.generateResultFile();

      // 记录程序结束日志
      await this.logToFile(`\n=== 程序执行完成 ===\n`);
      await this.logToFile(`结束时间: ${new Date().toLocaleString()}\n`);
      await this.logToFile(`处理结果: ${this.results.length} 个文件\n`);
      const successCount = this.results.filter(r => r.success).length;
      const failCount = this.results.filter(r => !r.success).length;
      const totalCost = this.results.reduce((sum, r) => sum + r.cost, 0);
      await this.logToFile(
        `成功: ${successCount}, 失败: ${failCount}, 总成本: $${totalCost.toFixed(6)}\n`,
      );
      await this.logToFile(`=====================================\n`);

      console.log('\n🎉 处理完成!');
    } catch (error) {
      console.error('❌ 处理过程中发生错误:', error);
      throw error;
    }
  }

  private async processFilesWithConcurrency(
    files: string[],
    promptFilePath: string,
  ): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];
    const semaphore = new Semaphore(this.concurrency);
    let completed = 0;
    let failed = 0;

    const processFile = async (file: string, index: number): Promise<void> => {
      await semaphore.acquire();
      try {
        console.log(
          `\n📦 [${index + 1}/${files.length}] 启动处理 (${this.concurrency} 并发)`,
        );
        const result = await this.processFile(file, promptFilePath);
        results.push(result);

        if (result.success) {
          completed++;
          console.log(
            `🎯 进度: ${completed} 成功, ${failed} 失败, ${files.length - completed - failed} 剩余`,
          );
        } else {
          failed++;
          console.log(
            `⚠️  进度: ${completed} 成功, ${failed} 失败, ${files.length - completed - failed} 剩余`,
          );
        }
      } finally {
        semaphore.release();
      }
    };

    // 启动所有任务
    const promises = files.map(
      async (file, index) => await processFile(file, index),
    );
    await Promise.all(promises);

    return results;
  }
}

// 简单的信号量实现
class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift();
      resolve?.();
    } else {
      this.permits++;
    }
  }
}


// 注册 yargs 命令
import { cli } from '../cli.js';

cli.command(
  'ai',
  'AI 代码处理工具 (使用 Claude Code CLI)',
  yargs => {
    return yargs
      .option('path', {
        alias: 'p',
        describe: '要处理的文件或目录路径',
        type: 'string',
        demandOption: true,
        requiresArg: true,
      })
      .option('config', {
        alias: 'c',
        describe: '包含 AI 提示内容的文件路径',
        type: 'string',
        demandOption: true,
        requiresArg: true,
      })
      .option('filter', {
        alias: 'f',
        describe: '用于过滤文件的正则表达式',
        type: 'string',
        requiresArg: true,
      })
      .option('threads', {
        alias: 't',
        describe: '并发处理线程数',
        type: 'number',
        default: 1,
        requiresArg: true,
      })
      .example('$0 ai -p ./src -c ./SPEC.md', '处理 src 目录下的所有文件')
      .example('$0 ai -p ./src -c ./prompt.txt -f "\\.ts$" -t 4', '处理所有 .ts 文件，使用 4 个线程')
      .example('$0 ai -p ./src/index.ts -c ./prompt.txt', '处理单个文件');
  },
  async args => {
    const targetPath = args.path;
    const configPath = args.config;
    const filterPattern = args.filter;
    const threads = args.threads ?? 1;

    if (!targetPath || !configPath) {
      console.error('❌ 缺少必要参数: --path 和 --config');
      process.exit(1);
    }

    // 运行处理器
    const processor = new AIProcessor(
      configPath,
      targetPath,
      filterPattern,
      threads,
    );
    
    try {
      await processor.run();
    } catch (error) {
      console.error('❌ 处理过程中发生错误:', error);
      process.exit(1);
    }
  },
);
