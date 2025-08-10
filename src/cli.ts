import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolveConfig } from "./config.js";
import { scriptExt } from "./shared.js";

export type Argv = typeof argv;

export const cli = yargs(hideBin(process.argv))
    .scriptName("utc")
    // 全局选项
    .option("project", {
        alias: "p",
        describe: "Project path.",
        type: "string",
        defaultDescription: "Current working directory",
        requiresArg: true,
    })
    .option("js.source", {
        describe: "JavaScript Source code paths.",
        type: "string",
        defaultDescription: `src/**/*.${scriptExt}`,
    })
    .command(
        "*",
        false,
        () => {},
        async args => {
            await printDebugInfo(args);
        },
    )
    // 配置
    .alias("v", "version")
    .alias("h", "help")
    // NOTE: yargs 不能很好地处理点号（.）分隔的选项
    .parserConfiguration({ "dot-notation": false })
    .detectLocale(false)
    .demandCommand(1, "You need at least one command before moving on.")
    .strict()
    .wrap(yargs().terminalWidth())
    .recommendCommands();

// 子命令
await import("./commands/init.js");
await import("./commands/lint.js");

const argv = await cli.parseAsync();

export async function printDebugInfo(args: Argv) {
    console.log("Cmd Args:", args);
    console.log("Config:", await resolveConfig(args));
}
