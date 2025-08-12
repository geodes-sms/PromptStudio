import * as fs from "fs";
import {
    get_data_inputs_by_dataset,
    get_experiment_by_name,
    get_last_input_id,
    get_llm_by_base_model,
    get_llm_by_id,
    get_next_input, get_node_by_id,
    get_node_by_name, get_parents, get_processor_results_by_id,
    get_prompt_config_by_experiment,
    get_results,
    get_results_by_template, get_target_var,
    get_template_by_id,
    pool,
    save_dataset,
    save_evaluator, save_experiment,
    save_link,
    save_llm,
    save_llm_param,
    save_node,
    save_processor,
    save_promptconfig,
    save_template,
} from "../database/database";
import * as yaml from "js-yaml";
import {
    Dataset,
    Evaluator,
    Experiment_node,
    Llm_params,
    NodeType,
    ProcessorResult,
    Promptconfig,
    prompttemplate
} from "./types";
import {LLMSpec, PromptVarsDict} from "../typing";
import {get_marker_map} from "./utils";
import {getTokenCount} from "./token";
import {PoolConnection} from "mysql2/promise";

/**
 * Handles saving a prompt template to the database.
 * It saves the template itself, its associated LLMs, and their parameters.
 * @param template The prompt template to save.
 * @param connection The database connection to use for saving.
 * @param experiment_id The ID of the experiment to which the template belongs.
 */
async function handle_save_template(template: prompttemplate, connection: PoolConnection, experiment_id: number){
    const node_id = await save_node('prompt_template', experiment_id, template.name, connection);
    await save_template(template.value, template.name, template.iterations || 1, node_id, connection);
    // Save 1 config for each LLM in the template
    for (const llm of template.llms as LLMSpec[]) {
        const existing = await get_llm_by_base_model(llm.base_model, connection);
        const llm_id = existing ? existing.id : await save_llm(llm, connection);

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

        const llm_param_id = await save_llm_param(llm_params, connection);
        const config_id = await save_promptconfig(
            experiment_id,
            llm_id,
            llm_param_id,
            node_id,
            null,
            connection
        );
    }
}

/**
 * Handles saving a dataset node to the database.
 * @param dataset The dataset to save.
 * @param connection The database connection to use for saving.
 * @param file_map A map of file fields to their uploaded files.
 * @param experiment_id The ID of the experiment to which the dataset belongs.
 */
async function handle_save_dataset(dataset: Dataset, connection:PoolConnection, file_map: Record<string, Express.Multer.File[]>, experiment_id: number){
    const node_id = await save_node('dataset', experiment_id, dataset.name, connection);
    const fileField = `file:${dataset.path}`;
    const datasetPath = file_map[fileField]?.[0]?.path ?? dataset.path;
    await save_dataset(datasetPath, node_id, dataset.name, connection);
}

/**
 * Handles saving an evaluator node to the database.
 * @param evaluator The evaluator to save.
 * @param connection The database connection to use for saving.
 * @param file_map A map of file fields to their uploaded files.
 * @param experiment_id The ID of the experiment to which the evaluator belongs.
 */
async function handle_save_evaluator(evaluator: Evaluator, connection: PoolConnection, file_map: Record<string, Express.Multer.File[]>, experiment_id: number){
    const node_id = await save_node('evaluator', experiment_id, evaluator.name, connection);
    const fileField = `evaluator:${evaluator.file}`;
    const evaluatorPath = file_map[fileField]?.[0]?.path ?? evaluator.file;
    const evaluatorCode = fs.readFileSync(evaluatorPath, "utf-8");
    await save_evaluator({ ...evaluator, code: evaluatorCode, node_id: node_id }, connection);
}

/**
 * Handles saving a processor node to the database.
 * @param processor The processor to save.
 * @param connection The database connection to use for saving.
 * @param file_map A map of file fields to their uploaded files.
 * @param experiment_id The ID of the experiment to which the processor belongs.
 */
async function handle_save_processor(processor: any, connection: PoolConnection, file_map: Record<string, Express.Multer.File[]>, experiment_id: number){
    const node_id = await save_node('processor', experiment_id, processor.name, connection);
    const fileField = `processor:${processor.file}`;
    const processorPath = file_map[fileField]?.[0]?.path ?? processor.file;
    const processorCode = fs.readFileSync(processorPath, "utf-8");
    await save_processor({ ...processor, code: processorCode, node_id: node_id }, connection);
}

/**
 * Saves a configuration from a YAML file to the database.
 * @param yml_path The path to the YAML configuration file.
 * @param file_map A map of file fields to their uploaded files.
 */
export async function save_config(
    yml_path: string, file_map: Record<string, Express.Multer.File[]>
){
    const connection: PoolConnection = await pool.getConnection();
    try{
        // Begin transaction to ensure we can rollback in case of errors
        await connection.beginTransaction();
        const raw = fs.readFileSync(yml_path, "utf-8");
        const parsed: any = yaml.load(raw);
        let experimentName = parsed.experiment.title;
        let counter = 1;
        let existingExperiment = await get_experiment_by_name(experimentName, connection);
        // Ensure unique experiment name
        while (existingExperiment) {
            experimentName = `${parsed.experiment.title}_${counter++}`;
            existingExperiment = await get_experiment_by_name(experimentName, connection);
        }
        // Save experiment
        const experiment_id = await save_experiment({ ...parsed.experiment, title: experimentName }, connection);
        const promises: Promise<any>[] = [];
        // Save each node in the configuration
        for (const node of parsed.nodes){
            if (node.template){
                await handle_save_template(node.template, connection, experiment_id);
            }
            else if(node.dataset){
                promises.push(handle_save_dataset(node.dataset, connection, file_map, experiment_id));
            }
            else if(node.evaluator){
                promises.push(handle_save_evaluator(node.evaluator, connection, file_map, experiment_id));
            }
            else if(node.processor){
                promises.push(handle_save_processor(node.processor, connection, file_map, experiment_id));
            }
            else{
                throw new Error(`Unknown node type in configuration: ${JSON.stringify(node)}`);
            }
        }
        await Promise.all(promises);
        const promisesLinks: Promise<any>[] = [];
        // Save links between nodes
        for (const link of parsed.links){
            const sourceNode: Experiment_node = await get_node_by_name(link.source, experiment_id, connection);
            const targetNode: Experiment_node = await get_node_by_name(link.target, experiment_id, connection);
            if (!sourceNode || !targetNode) {
                throw new Error(`Link error: source or target node not found for link ${JSON.stringify(link)}`);
            }
            promisesLinks.push(save_link(sourceNode.id, targetNode.id,  link.source_var || null, link.target_var || null, connection));
        }
        await Promise.all(promisesLinks);
        await connection.commit();
        return experimentName;
    }
    catch (error) {
        console.error("Error saving configuration nodes:", error);
        await connection.rollback();
    } finally {
        connection.release();
    }
}

/**
 * Calculates the Cartesian product of an array of arrays.
 * @param arrays An array of arrays, where each inner array is a record of string key-value pairs.
 */
export function cartesianProduct(arrays: Record<string, string>[][]): Record<string, string>[] {
    if (arrays.length === 0) return [];

    return arrays.reduce((acc, curr) => {
        const result: Record<string, string>[] = [];

        for (const a of acc) {
            for (const b of curr) {
                result.push({ ...a, ...b });
            }
        }
        return result;
    }, [{}] as Record<string, string>[]);
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
            const llm = await get_llm_by_id(config.LLM_id);
            const template = await get_template_by_id(config.prompt_template_id);
            const model = llm.base_model;

            let input_id = 0;
            const last_id = await get_last_input_id(config.final_dataset_id);

            while (input_id !== last_id) {
                const input = await get_next_input(config.final_dataset_id, input_id);
                if (!input) break;

                input_id = input.id;
                const results = await get_results(config.id, input_id);

                let remainingIterations = template.iterations;

                if (results && results.length > 0) {
                    remainingIterations -= results.length;
                }
                if (remainingIterations <= 0) {
                    continue;
                }

                const markersDict = await get_marker_map(input);
                const prompt = fillTemplate(template.value, markersDict);

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

/**
 * Recursively resolves inputs for a node by checking its parents.
 * If the node has no parents, it retrieves inputs directly from the dataset.
 * If it has parents, it resolves inputs from each parent and combines them.
 * @param node_id The ID of the node for which to resolve inputs.
 */
export async function resolve_inputs(node_id: number): Promise<PromptVarsDict[]> {
    const dataset_parents: number[] = await get_parents(node_id, 'dataset');
    const template_parents: number[] = await get_parents(node_id, 'prompt_template');
    const processor_parents: number[] = await get_parents(node_id, 'processor');

    // If no parents leaf dataset pull input rows directly
    if (dataset_parents.length + template_parents.length + processor_parents.length === 0) {
        return await get_data_inputs_by_dataset(node_id);
    }

    // Otherwise recursively resolve each parent
    const resolved_per_parent: PromptVarsDict[][] = [];

    for (const parent_id of dataset_parents) {
        const parent_inputs = await resolve_inputs(parent_id);
        const mapped_inputs: PromptVarsDict[] = [];

        for (const input of parent_inputs) {
            const dict: PromptVarsDict = {};
            for (const marker of Object.keys(input)) {
                const target_var = await get_target_var(parent_id, node_id, marker);
                if(target_var !== undefined) {
                    dict[target_var] = input[marker];
                }
                else{
                    dict[marker] = input[marker];
                }
            }
            mapped_inputs.push(dict);
        }
        resolved_per_parent.push(mapped_inputs);
    }

    for (const parent_id of template_parents){
        const results = await get_results_by_template(parent_id.toString());
        const new_inputs: PromptVarsDict[] = [];
        const target_var = await get_target_var(parent_id, node_id, 'prompt');
        if (target_var === null || target_var === undefined) {
            continue;
        }
        for (const result of results) {
            const dict: PromptVarsDict = {};
            dict[target_var] = result.output_result;
            new_inputs.push(dict);
        }
        resolved_per_parent.push(new_inputs);
    }

    for (const parent_id of processor_parents) {
        const results: ProcessorResult[] = await get_processor_results_by_id(parent_id);
        const new_inputs: PromptVarsDict[] = [];
        const target_var = await get_target_var(parent_id, node_id, 'output');
        for (const result of results) {
            const dict: PromptVarsDict = {};
            dict[target_var] = result.processor_result;
            new_inputs.push(dict);
        }
        resolved_per_parent.push(new_inputs);
    }

    const current_node = await get_node_by_id(node_id);
    if (current_node.type === NodeType.dataset) {
        const inputs = await get_data_inputs_by_dataset(node_id);
        resolved_per_parent.push(inputs);
    }
    // Combine
    return cartesianProduct(resolved_per_parent);
}

export function fillTemplate(
    template: string,
    vars: PromptVarsDict
): string {
    return template.replace(/\{([^}]+)}/g, (_, marker) => {
        const entry = vars[marker];
        if (entry == null || typeof entry !== "string") {
            return `{${marker}}`;
        }
        return entry;
    });
}