import { cli, printBaseInfo } from "./cli.js";

cli.command(
    "lint",
    "Check if the code conforms to the team specs.",
    (argv) => {
        return argv
            .option("staged", {
                describe: "Check staged files only.",
                type: "boolean",
                default: false,
            })
            .option("message", {
                alias: "m",
                describe: "Check the incoming commit message.",
                type: "string",
                requiresArg: true,
            });
    },
    async (args) => {
        if (args.message != null) {
            printBaseInfo(args);
        }

        if (args.staged) {
        }

        console.log("Linting code...");
    }
);
