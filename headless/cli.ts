import { Command } from "commander";
import {evaluate_experiment, getTotalTokenCountForExperiment, run_experiment, save_config} from "./apiCall";
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
        .option("-e, --evaluate <string>", "Name of the experiment to evaluate")
        .action((options) => {
            if ((options.name && (options.config || options.evaluate)) || (options.evaluate && (options.config || options.name))) {
                console.error("Please chose only 1 option.");
                process.exit(1);
            }
        })
        .parse(process.argv);

    const options = program.opts();

    const keysPath = path.join(process.cwd(), "api_keys.json");
    if (!fs.existsSync(keysPath)) {
        console.error(`Required file 'api_keys.json' not found in ${keysPath}`);
        process.exit(1);
    }

    let api_keys: Record<string, string> = {};
    try {
        api_keys = JSON.parse(fs.readFileSync(keysPath, "utf-8"));
    } catch (err) {
        console.error("Failed to parse 'api_keys.json':", err);
        process.exit(1);
    }

    if (options.config) {
        const name = await save_config(options.config);
        console.log(`Experiment saved as: ${name}`);
        const validate = await validateRun(name);
        if (!validate) {
            console.log("Experiment run cancelled.");
            process.exit(0);
        }
        await run_experiment(name, api_keys);
        await evaluate_experiment(name);
    } else if (options.name) {
        const validate = await validateRun(options.name);
        if (!validate) {
            console.log("Experiment run cancelled.");
            process.exit(0);
        }
        await run_experiment(options.name, api_keys);
        await evaluate_experiment(options.name);
    }else if (options.evaluate) {
        await evaluate_experiment(options.evaluate);
    }
    else {
        console.error("Please provide a configuration file or an experiment name.");
        process.exit(1);
    }
}

main();
