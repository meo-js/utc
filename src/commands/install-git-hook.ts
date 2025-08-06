import { setHooksFromConfig } from "simple-git-hooks/simple-git-hooks.js";
import { cli } from "../cli.js";
import { resolveConfig } from "../config.js";

const configPath = new URL("../assets/simple-git-hooks.json", import.meta.url)
    .pathname;

cli.command(
    "install-git-hook",
    "Install Git hook scripts to ensure compliance with team specs before committing code.",
    () => {},
    async args => {
        console.log("Installing git hooks...");
        const config = await resolveConfig(args);
        await setHooksFromConfig(config.project, ["", "", configPath]);
        console.log("Successfully set all git hooks.");
    },
);
