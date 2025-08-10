import { checkbox } from "@inquirer/prompts";
import { detectPackageManager, writePackageJson } from "@meojs/pkg-utils";
import { writeFile } from "fs/promises";
import spawn from "nano-spawn";
import {
    removeHooks,
    setHooksFromConfig,
} from "simple-git-hooks/simple-git-hooks.js";
import cliPackageJson from "../../package.json" with { type: "json" };
import { cli } from "../cli.js";
import { resolveConfig } from "../config.js";
import { simpleGitHooksConfigPath } from "../shared.js";

const simpleGitHooksConfig = {
    "pre-commit": "{PM} exec utc lint --staged",
    "commit-msg": "{PM} exec utc lint -m $1",
};

// Old version of peer dependencies to remove
const oldPeerDeps = { "eslint": "", "prettier": "", "@meojs/cfgs": "" };

cli.command(
    "init",
    "Initialize project.",
    () => {},
    async args => {
        const config = await resolveConfig(args);

        const selected = await checkbox({
            message: "Select features to initialize:",
            choices: [
                {
                    name: "Git Hooks",
                    value: "git-hooks",
                    checked: true,
                },
                {
                    name: "Update Dependencies",
                    value: "update-deps",
                    checked: false,
                },
                {
                    name: "Prepare Script",
                    value: "prepare-script",
                    checked: true,
                },
            ],
        });

        if (selected.includes("git-hooks")) {
            await installGitHooks(config.project);
        }

        if (selected.includes("update-deps")) {
            await updateDependencies(config.project);
        }

        if (selected.includes("prepare-script")) {
            await installPrepareScript(config.project);
        }
    },
);

cli.command(
    "uninit",
    "Deinitialize project.",
    () => {},
    async args => {
        const config = await resolveConfig(args);

        const selected = await checkbox({
            message: "Select features to deinitialize:",
            choices: [
                {
                    name: "Git Hooks",
                    value: "git-hooks",
                    checked: true,
                },
                {
                    name: "Remove Dependencies",
                    value: "remove-deps",
                    checked: false,
                },
                {
                    name: "Remove Prepare Script",
                    value: "remove-prepare-script",
                    checked: true,
                },
            ],
        });

        if (selected.includes("git-hooks")) {
            await uninstallGitHooks(config.project);
        }

        if (selected.includes("remove-deps")) {
            await removeDependencies(config.project);
        }

        if (selected.includes("remove-prepare-script")) {
            await uninstallPrepareScript(config.project);
        }
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
).hide("install-git-hook");

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
).hide("uninstall-git-hook");

async function installGitHooks(projectPath: string) {
    console.log("Installing git hooks...");

    const pm = (await detectPackageManager(projectPath)).cmd;
    const configContent = JSON.stringify(
        Object.fromEntries(
            Object.entries(simpleGitHooksConfig).map(([key, value]) => [
                key,
                value.replace(/\{PM\}/g, pm),
            ]),
        ),
        null,
        2,
    );

    await writeFile(simpleGitHooksConfigPath, configContent);
    await setHooksFromConfig(projectPath, ["", "", simpleGitHooksConfigPath]);
    console.log("Successfully set all git hooks.");
}

async function uninstallGitHooks(projectPath: string) {
    console.log("Uninstalling git hooks...");
    await removeHooks(projectPath);
    console.log("Successfully removed all git hooks.");
}

async function removeDependencies(projectPath: string) {
    console.log("Removing dependencies...");

    try {
        await writePackageJson(projectPath, json => {
            if (!json.devDependencies) {
                console.log("No devDependencies found in project package.json");
                return json;
            }

            const needRemovePeerDeps = Object.assign(
                {},
                oldPeerDeps,
                cliPackageJson.peerDependencies,
            );
            const devDeps = json.devDependencies;

            Object.keys(needRemovePeerDeps).forEach(depName => {
                if (devDeps[depName]) {
                    delete devDeps[depName];
                    console.log(`Removed ${depName} from devDependencies`);
                }
            });
            return json;
        });

        console.log("Removed CLI peerDependencies from devDependencies");
        console.log("Running install...");

        const pm = (await detectPackageManager(projectPath)).cmd;

        await spawn(pm, ["install"], {
            cwd: projectPath,
            stdio: "inherit",
        });

        console.log("Dependencies removed successfully!");
    } catch (error) {
        console.error("Error removing dependencies:", error);
        throw error;
    }
}

async function updateDependencies(projectPath: string) {
    console.log("Updating dependencies...");

    try {
        if (!cliPackageJson.peerDependencies) {
            console.log("No peerDependencies found in CLI package.json");
            return;
        }

        await writePackageJson(projectPath, json => {
            if (!json.devDependencies) {
                json.devDependencies = {};
            }

            const cliPeerDeps = cliPackageJson.peerDependencies;
            const devDeps = json.devDependencies;

            Object.keys(cliPeerDeps).forEach(depName => {
                const verRange = cliPeerDeps[depName as never];
                devDeps[depName] = verRange;
            });
            return json;
        });

        console.log("Updated devDependencies from CLI peerDependencies");
        console.log("Running install...");

        const pm = (await detectPackageManager(projectPath)).cmd;

        await spawn(pm, ["install"], {
            cwd: projectPath,
            stdio: "inherit",
        });

        console.log("Dependencies updated successfully!");
    } catch (error) {
        console.error("Error updating dependencies:", error);
        throw error;
    }
}

async function installPrepareScript(projectPath: string) {
    console.log("Installing prepare script...");

    try {
        const pm = (await detectPackageManager(projectPath)).cmd;
        const prepareScript = `${pm} exec utc install-git-hook`;

        await writePackageJson(projectPath, json => {
            if (!json.scripts) {
                json.scripts = {};
            }
            json.scripts.prepare = prepareScript;
            return json;
        });

        console.log("Successfully installed prepare script in package.json");
    } catch (error) {
        console.error("Error installing prepare script:", error);
        throw error;
    }
}

async function uninstallPrepareScript(projectPath: string) {
    console.log("Uninstalling prepare script...");

    try {
        await writePackageJson(projectPath, json => {
            if (!json.scripts) {
                console.log("No scripts found in package.json");
                return json;
            }

            if (json.scripts.prepare) {
                delete json.scripts.prepare;
                console.log("Removed prepare script from package.json");
            } else {
                console.log("No prepare script found in package.json");
            }
            return json;
        });

        console.log("Successfully uninstalled prepare script");
    } catch (error) {
        console.error("Error uninstalling prepare script:", error);
        throw error;
    }
}
