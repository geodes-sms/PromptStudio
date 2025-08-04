import { Command } from "commander";
import {getTotalTokenCountForExperiment, run_experiment, save_config} from "./apiCall";
// @ts-ignore
import fs from "fs";
import * as path from "node:path";

/**
 * Validates if the user wants to run the experiment by checking the total token count.
 * @param name The name of the experiment.
 */
async function validateRun(name: string): Promise<boolean> {
    console.log("Total estimate input tokens: ", await getTotalTokenCountForExperiment(name));
    const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        readline.question("Are you sure you want to run this experiment? (Y/N) ", (answer: string) => {
            readline.close();
            resolve(answer.toLowerCase() === "y");
        });
    });
}

/**
 * Main function to handle command line arguments and execute the experiment.
 * The user can provide either a configuration file using -c or an experiment name using -n.
 */
async function main() {
    const program = new Command();
    program
        .name("headless")
        .option("-c, --config <string>", "Path to the YAML configuration file")
        .option("-n, --name <string>", "Name of the experiment to run")
        .action((options) => {
            if (options.name && options.config) {
                console.error("Please chose only 1 option.");
                process.exit(1);
            }
        })
        .parse(process.argv);

    const options = program.opts();

    const credentialsPath = path.join(process.cwd(), "../credentials.json");
    if (!fs.existsSync(credentialsPath)) {
        console.error(`Required file 'credentials.json' not found in ${credentialsPath}`);
        process.exit(1);
    }

    let api_keys: Record<string, string> = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
        api_keys = parsed.api_keys;
    } catch (err) {
        console.error("Failed to parse 'credentials.json':", err);
        process.exit(1);
    }

    if (options.config) {
        // Check if the provided config file exists
        if (!fs.existsSync(options.config)) {
            console.error(`Configuration file not found: ${options.config}`);
            process.exit(1);
        }
        const name = await save_config(options.config);
        console.log(`Experiment saved as: ${name}`);
        const validate = await validateRun(name);
        if (!validate) {
            console.log("Experiment run cancelled.");
            process.exit(0);
        }
        await run_experiment(name, api_keys);
    } else if (options.name) {
        const validate = await validateRun(options.name);
        if (!validate) {
            console.log("Experiment run cancelled.");
            process.exit(0);
        }
        await run_experiment(options.name, api_keys);
    }
    else {
        console.error("Please provide a configuration file or an experiment name.");
        process.exit(1);
    }
}

main();
