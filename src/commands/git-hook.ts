import {
    removeHooks,
    setHooksFromConfig,
} from "simple-git-hooks/simple-git-hooks.js";
import { cli } from "../cli.js";
import { resolveConfig } from "../config.js";

const configPath = new URL("../assets/simple-git-hooks.json", import.meta.url)
    .pathname;

async function installGitHooks(projectPath: string) {
    console.log("Installing git hooks...");
    await setHooksFromConfig(projectPath, ["", "", configPath]);
    console.log("Successfully set all git hooks.");
}

cli.command(
    "init",
    "Initialize project.",
    () => {},
    async args => {
        const config = await resolveConfig(args);
        await installGitHooks(config.project);
    },
);

cli.command(
    "install-git-hook",
    "Install Git hook scripts to ensure compliance with team specs before committing code.",
    () => {},
    async args => {
        const config = await resolveConfig(args);
        await installGitHooks(config.project);
    },
);

cli.command(
    "uninstall-git-hook",
    "Uninstall Git hook scripts.",
    () => {},
    async args => {
        console.log("Uninstalling git hooks...");
        const config = await resolveConfig(args);
        await removeHooks(config.project);
        console.log("Successfully removed all git hooks.");
    },
);
