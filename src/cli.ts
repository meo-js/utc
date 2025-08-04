import { chdir, cwd } from "process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// TODO: 测试
chdir("./example");

export const cli = yargs(hideBin(process.argv))
    .scriptName("utc")
    // 全局选项
    .option("project", {
        alias: "p",
        describe: "Project path.",
        type: "string",
        default: cwd(),
        defaultDescription: "Current working directory",
    })
    // 配置
    .alias("v", "version")
    .alias("h", "help")
    .detectLocale(false)
    .demandCommand(1, "You need at least one command before moving on.")
    .strict()
    .wrap(yargs().terminalWidth())
    .recommendCommands();

// 子命令
await import("./lint.js");
await import("./install-git-hook.js");

const argv = await cli.parseAsync();

export function printBaseInfo(args: typeof argv) {
    console.log("Project Path:", args.project);
}
