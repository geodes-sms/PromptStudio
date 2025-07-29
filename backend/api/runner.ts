import {
    add_rows_to_dataset,
    get_configs_by_template_id,
    get_experiment_by_name,
    get_links_by_experiment,
    get_nodes_by_experiment,
    save_dataset_inputs, update_final_dataset,
} from "../database/database";
import {Experiment, Experiment_node, Link, NodeType} from "./types";
import {resolve_inputs} from "./configHandler";
import {ExperimentRunner} from "./ExperimentRunner";
import {Dict} from "../typing";
import {EvaluatorRunner} from "./EvaluatorRunner";

async function run_template(node_id: number, api_keys: Dict<string>, experiment: Experiment) {
    try{
        const inputs = await resolve_inputs(node_id);
        const configs = await get_configs_by_template_id(node_id);
        let dataset_id: number;
        // Check if we already have a final dataset meaning we have run this template before
        for (const config of configs) {
            if (config.final_dataset_id){
                dataset_id = config.final_dataset_id;
                // If we have a final dataset, we can skip the dataset creation step, but we need to add the new inputs to it
                await add_rows_to_dataset(dataset_id, inputs);
                break;
            }
        }
        // If we don't have a final dataset, we need to create one, at first run
        if (!dataset_id){
            dataset_id = await save_dataset_inputs(inputs, experiment.id);
        }
        const promises: Promise<void>[] = [];
        for (const config of configs) {
            promises.push(update_final_dataset(config.id, dataset_id));
        }
        await Promise.all(promises);
        const num_workers = experiment.threads || 1;
        const runner = new ExperimentRunner(experiment.title, num_workers, configs, api_keys);
        await runner.run();
    }
    catch (error) {
        console.error(`Error running template ${node_id}:`, error);
    }
}

async function run_evaluator(evaluator_id: number, experiment: Experiment){
    try{
        const num_workers = experiment.threads || 1;
        const runner = new EvaluatorRunner(experiment.title, num_workers, evaluator_id);
        await runner.evaluate();
    }
    catch (error) {
        console.error(`Error running evaluator ${evaluator_id}:`, error);
    }
}

async function run_processor(processor_id: number, experiment: Experiment){
    try{
        const num_workers = experiment.threads || 1;
        const runner = new EvaluatorRunner(experiment.title, num_workers, processor_id);
        await runner.process();
    }
    catch (error) {
        console.error(`Error running processor ${processor_id}:`, error);
    }
}


export async function run_experiment(experiment_name: string, api_keys: Dict<string>) {
    try{
        const experiment = await get_experiment_by_name(experiment_name);
        const nodes = await get_nodes_by_experiment(experiment.id);
        const links = await get_links_by_experiment(experiment.id);
        const sorted_nodes = topologicalSort(nodes, links);
        for (const node of sorted_nodes){
            switch (node.type) {
                case NodeType.dataset:
                    break;
                case NodeType.prompt_template:
                    await run_template(node.id, api_keys, experiment);
                    break;
                case NodeType.evaluator:
                    await run_evaluator(node.id, experiment);
                    break;
                case NodeType.processor:
                    await run_processor(node.id, experiment);
                    break;
                default:
                    console.warn(`Unknown node type for node ${node.id}`);
            }
        }
    }
    catch (error) {
        console.error(`Error running experiment ${experiment_name}:`, error);
    }
}

/**
 * Do a topological sort of the DAG using Kahn's algorithm.
 * @param nodes An array of Experiment_node objects representing the nodes in the experiment.
 * @param links An array of Link objects representing the edges between nodes.
 */
function topologicalSort(nodes: Experiment_node[], links: Link[]): Experiment_node[] {
    const inDegree = new Map<number, number>();
    const graph = new Map<number, number[]>();

    for (const node of nodes) {
        inDegree.set(node.id, 0);
        graph.set(node.id, []);
    }

    for (const link of links) {
        graph.get(link.source_node_id)!.push(link.target_node_id);
        inDegree.set(link.target_node_id, inDegree.get(link.target_node_id)! + 1);
    }

    const queue: number[] = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    const result: Experiment_node[] = [];

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentNode = nodes.find(n => n.id === currentId)!;
        result.push(currentNode);

        for (const neighbor of graph.get(currentId)!) {
            inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
            if (inDegree.get(neighbor) === 0) {
                queue.push(neighbor);
            }
        }
    }

    if (result.length !== nodes.length) {
        throw new Error("Cycle detected in graph — dependency resolution failed.");
    }

    return result;
}
