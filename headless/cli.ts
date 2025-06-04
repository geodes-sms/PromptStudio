import { Command } from "commander";
import {
    evaluate_experiment,
    getTotalTokenCountForExperiment,
    run_experiment,
    save_config,
} from "./generate";

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

async function main() {
    const program = new Command();
    program
        .name("headless")
        .option("-c, --config <string>", "Path to the YAML configuration file")
        .option("-n, --name <string>", "Name of the experiment")
        .action((options) => {
            if (options.name && options.config) {
                console.error("Please provide either a configuration file or an experiment name, not both.");
                process.exit(1);
            }
        })
        .parse(process.argv);

    const options = program.opts();

    if (options.config) {
        const name = await save_config(options.config);
        console.log(`Experiment saved as: ${name}`);
        const validate = await validateRun(name);
        if (!validate) {
            console.log("Experiment run cancelled.");
            process.exit(0);
        }
        await run_experiment(name);
        await evaluate_experiment(name);
    } else if (options.name) {
        const validate = await validateRun(options.name);
        if (!validate) {
            console.log("Experiment run cancelled.");
            process.exit(0);
        }
        await run_experiment(options.name);
        await evaluate_experiment(options.name);
    } else {
        console.error("Please provide a configuration file or an experiment name.");
        process.exit(1);
    }
}

main();
