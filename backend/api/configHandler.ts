import fs from "fs";
import {
    add_config_base_dataset,
    get_all_input_ids_from_dataset,
    get_base_datasets,
    get_config,
    get_dataset_by_id,
    get_dataset_by_name,
    get_dataset_size,
    get_evaluator_by_name,
    get_experiment_by_name,
    get_input_by_id, get_last_input_id,
    get_last_seen_result_id,
    get_llm_by_base_model, get_llm_by_id, get_llm_param_by_id, get_next_input,
    get_prompt_config_by_experiment, get_results,
    get_results_by_template, get_template_by_id,
    get_template_by_name,
    save_combination_as_input,
    save_dataset,
    save_evaluator,
    save_evaluator_config,
    save_experiment,
    save_llm,
    save_llm_param,
    save_promptconfig,
    save_template,
    update_promptconfig_final_dataset,
    update_template_dependency_progress,
    update_template_vars
} from "../database/database";
import yaml from "js-yaml";
import {Evaluator, Experiment, Llm_params, Promptconfig} from "./types";
import {LLMSpec, PromptVarsDict} from "../typing";
import {get_marker_map} from "./utils";
import {PromptPermutationGenerator} from "../template";
import {getTokenCount} from "./token";


/**
 * Checks if the given graph has a cycle.
 * This function checks if there are any cyclic dependencies in the template graph.
 * @param graph A map representing the graph where keys are node names and values are arrays of neighboring nodes.
 */
function hasCycle(graph: Map<string, string[]>): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function dfs(node: string): boolean {
        if (!visited.has(node)) {
            visited.add(node);
            recStack.add(node);

            for (const neighbor of graph.get(node) || []) {
                if (!graph.has(neighbor)) {
                    throw new Error(`Template dependency error: '${node}' depends on unknown template '${neighbor}'`);
                }

                if (!visited.has(neighbor) && dfs(neighbor)) {
                    return true;
                } else if (recStack.has(neighbor)) {
                    return true;
                }
            }
        }
        recStack.delete(node);
        return false;
    }

    // @ts-ignore
    for (const node of graph.keys()) {
        if (dfs(node)) {
            return true;
        }
    }

    return false;
}

/**
 * Saves the configuration from a YAML file and processes it to create an experiment.
 * @param yml_path The path to the YAML configuration file.
 * @param file_map A map of file fields for datasets and evaluators to their corresponding uploaded files.
 */
export async function save_config(yml_path: string, file_map: Record<string, Express.Multer.File[]>): Promise<string | undefined> {
    try {
        const raw = fs.readFileSync(yml_path, "utf-8");
        const parsed: any = yaml.load(raw);

        let experimentName = parsed.experiment.title;
        let counter = 1;
        let existingExperiment = await get_experiment_by_name(experimentName);

        while (existingExperiment) {
            experimentName = `${parsed.experiment.title}_${counter++}`;
            existingExperiment = await get_experiment_by_name(experimentName);
        }

        // Cycle detection step
        const templateDeps = new Map<string, string[]>();
        for (const config of parsed.configs) {
            const templateName = config.template.name;
            if (config.template.vars && typeof config.template.vars === "object") {
                const deps: string[] = Object.values(config.template.vars);
                templateDeps.set(templateName, deps);
            } else {
                templateDeps.set(templateName, []);
            }
        }
        if (hasCycle(templateDeps)) {
            throw new Error("Invalid configuration: cyclic dependency between templates detected.");
        }

        // Save experiment
        const experiment_id = await save_experiment({ ...parsed.experiment, title: experimentName });
        const templateIdByName = new Map<string, number>();

        // Pass 1: Save templates
        for (const config of parsed.configs) {
            const templateName = config.template.name;
            const templateValue = config.template.value;

            let uniqueName = templateName;
            let templateCounter = 1;
            while (await get_template_by_name(uniqueName)) {
                uniqueName = `${templateName}_${templateCounter++}`;
            }

            const template_id = await save_template(templateValue, uniqueName, {});
            templateIdByName.set(templateName, template_id);
        }

        // Pass 2: Save configs
        for (const config of parsed.configs) {
            const template_id = templateIdByName.get(config.template.name)!;
            await update_template_vars(template_id, config.template.vars);

            const evaluator_ids: number[] = [];
            if (config.evaluators) {
                for (const evaluator of config.evaluators as Evaluator[]) {
                    const fileField = `evaluator:${evaluator.file}`;
                    const evaluatorPath = file_map[fileField]?.[0]?.path ?? evaluator.file;
                    const evaluatorCode = fs.readFileSync(evaluatorPath, "utf-8");

                    const existing = await get_evaluator_by_name(evaluator.name);
                    const evaluator_id = existing ? existing.id : await save_evaluator({ ...evaluator, code: evaluatorCode });
                    evaluator_ids.push(evaluator_id);
                }
            }

            for (const llm of config.llms as LLMSpec[]) {
                const existing = await get_llm_by_base_model(llm.base_model);
                const llm_id = existing ? existing.id : await save_llm(llm);

                const llm_params: Partial<Llm_params> = {};
                const custom_params: Record<string, string> = {};
                const known = ["max_tokens", "top_p", "top_k", "stop_sequence", "frequency_penalty", "presence_penalty"];
                const native = ["name", "model", "temp", "base_model", "settings", "emoji", "key"];

                if (llm.temp !== undefined) llm_params.temperature = llm.temp;
                for (const [k, v] of Object.entries(llm)) {
                    if (known.includes(k)) llm_params[k] = v;
                    else if (!native.includes(k) && v !== undefined) custom_params[k] = String(v);
                }
                if (Object.keys(custom_params).length > 0) llm_params.custom_params = custom_params;

                const llm_param_id = await save_llm_param(llm_params);
                const config_id = await save_promptconfig(experiment_id, llm_id, llm_param_id, template_id, null);

                if (config.datasets) {
                    for (const dataset of config.datasets) {
                        const fileField = `file:${dataset.path}`;
                        const datasetPath = file_map[fileField]?.[0]?.path ?? dataset.path;

                        const existing = await get_dataset_by_name(dataset.name);
                        const dataset_id = existing
                            ? existing.id
                            : await save_dataset(datasetPath, dataset.name, template_id);

                        await add_config_base_dataset(config_id, dataset_id);
                    }
                }

                for (const evaluator_id of evaluator_ids) {
                    await save_evaluator_config(evaluator_id, config_id);
                }
            }
        }

        return experimentName;
    } catch (error) {
        console.error("Error saving configuration:", error);
    }
}

/**
 * Prepares the configuration for an experiment by creating a synthetic dataset based on the provided prompt configuration and dependencies.
 * @param experiment The experiment object containing details about the experiment.
 * @param config The prompt configuration to prepare.
 * @param deps A record of dependencies where keys are variable names and values are template IDs.
 */
export async function prepare_config(experiment: Experiment, config: Promptconfig, deps: Record<string, string>) {
    const base_datasets = await get_base_datasets(config.id);

    const datasets = [];
    for (const ds of base_datasets) {
        const dataset = await get_dataset_by_id(ds);
        if (dataset) datasets.push(dataset);
    }

    const datasetIds = base_datasets.map(d => d).sort((a, b) => a - b).join('_');
    const synthetic_dataset_name = `synth_${experiment.title}_template${config.prompt_template_id}_datasets${datasetIds}`;
    let synthetic_dataset = await get_dataset_by_name(synthetic_dataset_name);
    let synthetic_dataset_id: number;

    if (synthetic_dataset) {
        synthetic_dataset_id = synthetic_dataset.id;
    } else {
        synthetic_dataset_id = await save_dataset('', synthetic_dataset_name, config.prompt_template_id);
    }

    await update_promptconfig_final_dataset(config.id, synthetic_dataset_id);

    const datasetInputs: PromptVarsDict[][] = [];
    for (const ds of datasets) {
        const inputIds = await get_all_input_ids_from_dataset(ds.id);
        const markersForDataset: PromptVarsDict[] = [];

        for (const input_id of inputIds) {
            const input = await get_input_by_id(input_id);
            const markers = await get_marker_map(input);
            markersForDataset.push(markers);
        }
        datasetInputs.push(markersForDataset);
    }

    const productOfInputs = cartesianProduct(datasetInputs);

    const latestProgress: Record<number, number> = {};
    const allResultsByTemplate: Record<number, string[]> = {};
    const newResultsByVar: Record<string, string[]> = {};

    for (const [varName, template_id] of Object.entries(deps)) {
        const lastSeen = await get_last_seen_result_id(Number(template_id));
        const allResults = await get_results_by_template(template_id);
        const newResults = allResults.filter(r => r.id > lastSeen);

        allResultsByTemplate[template_id] = allResults.map(r => r.output_result);

        if (newResults.length > 0) {
            latestProgress[template_id] = Math.max(...newResults.map(r => r.id));
            newResultsByVar[varName] = newResults.map(r => r.output_result);
        }
    }

    for (const [varName, newValues] of Object.entries(newResultsByVar)) {
        const otherVars = Object.keys(deps).filter(k => k !== varName);

        let combos: PromptVarsDict[] = [];

        for (const newVal of newValues) {
            let partialCombos: PromptVarsDict[] = [{}];

            for (const otherVar of otherVars) {
                const otherTemplateId = Number(deps[otherVar]);
                const results = allResultsByTemplate[otherTemplateId] || [];

                const nextCombos: PromptVarsDict[] = [];
                for (const partial of partialCombos) {
                    for (const val of results) {
                        nextCombos.push({ ...partial, [otherVar]: val });
                    }
                }

                partialCombos = nextCombos;
            }

            for (const partial of partialCombos) {
                combos.push({ ...partial, [varName]: newVal });
            }
        }

        for (const combo of combos) {
            for (const baseMarkers of productOfInputs) {
                const mergedBase = Object.assign({}, ...baseMarkers);
                const fullMarkers = { ...combo, ...mergedBase };
                await save_combination_as_input(synthetic_dataset_id, config.id, fullMarkers);
            }
        }
    }

    if (Object.keys(deps).length === 0) {
        for (const baseMarkers of productOfInputs) {
            const merged = Object.assign({}, ...baseMarkers);
            await save_combination_as_input(synthetic_dataset_id, config.id, merged);
        }
    }

    for (const [template_id, maxResultId] of Object.entries(latestProgress)) {
        await update_template_dependency_progress(Number(template_id), maxResultId);
    }
}

/**
 * Calculates the Cartesian product of multiple arrays.
 * This function takes an array of arrays and returns an array containing all possible combinations of elements from the input arrays.
 * @param arrays An array of arrays, where each inner array contains elements to combine.
 */
function cartesianProduct<T>(arrays: T[][]): T[][] {
    return arrays.reduce<T[][]>(
        (acc, curr) =>
            acc.flatMap(a => curr.map(b => [...a, b])),
        [[]]
    );
}

/**
 * Calculates the total number of inputs across all prompt configurations.
 * This function iterates through each prompt configuration, retrieves the final dataset ID, and sums the sizes of all datasets.
 * @param prompt_configs An array of Promptconfig objects representing the prompt configurations.
 */
export async function get_number_of_total_inputs(prompt_configs: Promptconfig[]) {
    let total_inputs = 0;
    for (const config of prompt_configs) {
        const updated_config = await get_config(config.id);
        if (updated_config.final_dataset_id) {
            total_inputs += await get_dataset_size(updated_config.final_dataset_id);
        }
    }
    return total_inputs;
}

/**
 * Calculates the total token count for an experiment by iterating through all prompt configurations and their inputs.
 * This function retrieves the experiment by name, gets all prompt configurations associated with it,
 * and for each configuration, it retrieves the final dataset and calculates the token count for each input.
 * @param experimentName The name of the experiment for which to calculate the total token count.
 */
export async function getTotalTokenCountForExperiment(experimentName: string): Promise<number> {
    try {
        const experiment = await get_experiment_by_name(experimentName);
        const prompt_configs: Promptconfig[] = await get_prompt_config_by_experiment(experiment.id);
        let totalTokens = 0;

        for (const config of prompt_configs) {
            if (!config.final_dataset_id) {
                continue;
            }
            const dataset = await get_dataset_by_id(config.final_dataset_id);
            const llm = await get_llm_by_id(config.LLM_id);
            const llm_param = await get_llm_param_by_id(config.LLM_param_id);
            const template = await get_template_by_id(config.prompt_template_id);
            const model = llm.base_model;

            let input_id = 0;
            const last_id = await get_last_input_id(dataset.id);

            while (input_id !== last_id) {
                const input = await get_next_input(dataset.id, input_id);
                if (!input) break;

                input_id = input.id;
                const results = await get_results(config.id, input_id);

                let remainingIterations = experiment.iterations;

                if (results && results.length > 0) {
                    remainingIterations -= results.length;
                }
                if (remainingIterations <= 0) {
                    continue;
                }

                const markersDict = await get_marker_map(input);
                const generator = new PromptPermutationGenerator(template.value);
                const prompt = generator.generate(markersDict).next().value.toString();

                const tokenCount = getTokenCount(model, prompt);
                totalTokens += tokenCount * remainingIterations;
            }
        }

        return totalTokens;
    } catch (error) {
        console.error("Error computing total token count:", error);
        return 0;
    }
}