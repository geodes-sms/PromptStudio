import {
    get_base_datasets, get_dataset_by_name,
    get_experiment_by_name,
    get_prompt_config_by_experiment,
    get_template_by_id, update_promptconfig_final_dataset
} from "../database/database";
import {Experiment, Promptconfig} from "./types";
import {get_number_of_total_inputs, prepare_config} from "./configHandler";
import {ExperimentRunner} from "./ExperimentRunner";
import * as path from "node:path";
import workerpool from "workerpool";
import {Dict} from "../typing";


/**
 * Runs all configurations given and processes the LLM calls in parallel using worker threads.
 * @param experiment The experiment object containing details about the experiment.
 * @param configs An array of Promptconfig objects representing the configurations to run.
 * @param api_keys A dictionary of API keys to use for the LLM calls.
 * @param eval_only A boolean indicating whether to run the experiment in evaluation mode only.
 */
async function run_configs(experiment: Experiment, configs: Promptconfig[], api_keys: Dict<string>, eval_only: boolean) {
    const total = await get_number_of_total_inputs(configs);
    // const bar = new ProgressBar("Processing LLM calls: [:bar] :percent :etas", { total });

    const num_workers = experiment.threads || 1;
    const pool = workerpool.pool(path.resolve(__dirname, 'worker.ts'), {
        minWorkers: num_workers,
        maxWorkers: num_workers,
        workerType: "thread",
        workerThreadOpts: {
            execArgv: ['--require', 'tsx']
        },
    });
    const runner = new ExperimentRunner(experiment.title, num_workers, pool, configs, api_keys);
    if (eval_only) {
        await runner.evaluate();
        return;
    }
    await runner.run();
}

export async function evaluate_experiment(experiment_name: string) {
    try {
        const experiment = await get_experiment_by_name(experiment_name);
        const prompt_configs = await get_prompt_config_by_experiment(experiment.id);
        await run_configs(experiment, prompt_configs, {}, true);
    } catch (error) {
        console.error(`Error evaluating experiment ${experiment_name}:`, error);
    }
}

/**
 * Runs an experiment by executing all prompt configurations in the specified experiment.
 * This function retrieves the experiment by name, processes each prompt configuration,
 * @param experiment_name The name of the experiment to run.
 * @param api_keys A dictionary of API keys to use for the LLM calls.
 */
export async function run_experiment(experiment_name: string, api_keys: Dict<string>) {
    try {
        const experiment = await get_experiment_by_name(experiment_name);
        const prompt_configs = await get_prompt_config_by_experiment(experiment.id);

        const independent: Promptconfig[] = [];
        const dependent: Promptconfig[] = [];

        const dependenciesByConfigId = new Map<number, Record<string, string>>();
        const configById = new Map<number, Promptconfig>();

        const synthetic_done = new Set<string>();

        for (const config of prompt_configs) {
            const template = await get_template_by_id(config.prompt_template_id);
            configById.set(config.id, config);

            const base_datasets = await get_base_datasets(config.id);

            if (template.vars && Object.keys(template.vars).length > 0) {
                dependent.push(config);
                dependenciesByConfigId.set(config.id, template.vars);
            } else if (base_datasets.length === 1) {
                await update_promptconfig_final_dataset(config.id, base_datasets[0]);
                independent.push(config);
            } else if (base_datasets.length > 1) {
                const datasetIds = base_datasets.map(d => d).sort((a,b) => a - b).join('_');
                const synthetic_key = `template${config.prompt_template_id}_datasets${datasetIds}`;

                const synthetic_dataset_name = `synth_${experiment.title}_template${config.prompt_template_id}_datasets${datasetIds}`;

                let synthetic_dataset = await get_dataset_by_name(synthetic_dataset_name);
                let synthetic_dataset_id: number;

                if (synthetic_dataset) {
                    synthetic_dataset_id = synthetic_dataset.id;
                } else {
                    if (!synthetic_done.has(synthetic_key)) {
                        await prepare_config(experiment, config, {});
                        synthetic_done.add(synthetic_key);
                    }
                    synthetic_dataset = await get_dataset_by_name(synthetic_dataset_name);
                    synthetic_dataset_id = synthetic_dataset.id;
                }
                await update_promptconfig_final_dataset(config.id, synthetic_dataset_id);
                independent.push(config);
            } else {
                console.warn(`Config ${config.id}: no datasets found! Skipping`);
            }
        }

        await run_configs(experiment, independent, api_keys, false);

        const doneTemplates = new Set<number>();
        for (const config of independent) {
            const template = await get_template_by_id(config.prompt_template_id);
            doneTemplates.add(template.id);
        }

        const remaining = new Set(dependent.map((cfg) => cfg.id));
        let progress = true;

        while (remaining.size > 0 && progress) {
            progress = false;

            for (const configId of Array.from(remaining)) {
                const config = configById.get(configId)!;
                const deps = dependenciesByConfigId.get(config.id)!;
                const depTemplateIds = Object.values(deps).map((x) => Number(x));

                const depsSatisfied = depTemplateIds.every((depId) => doneTemplates.has(depId));

                if (depsSatisfied) {
                    // console.log(`Running config ${config.id} after dependencies satisfied.`);

                    await prepare_config(experiment, config, deps);
                    await run_configs(experiment, [config], api_keys, false);

                    const template = await get_template_by_id(config.prompt_template_id);
                    doneTemplates.add(template.id);
                    remaining.delete(config.id);
                    progress = true;
                }
            }

            if (!progress && remaining.size > 0) {
                console.error(
                    "Cyclic or unsatisfiable dependencies detected! Remaining configs:",
                    Array.from(remaining)
                );
                throw new Error("Dependency resolution failed — cannot run experiment.");
            }
        }
    } catch (error) {
        console.error(error);
    }
}