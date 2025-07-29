import {LLMSpec, PromptVarsDict} from "../typing";
import {NodeType, ProcessorResult, Result} from "./types";
// @ts-ignore
import workerpool from "workerpool";
import {
    get_config, get_evaluation_result,
    get_input_by_id,
    get_last_input_id,
    get_links_by_target,
    get_llm_by_id,
    get_llm_param_by_id,
    get_next_input,
    get_node_by_id,
    get_processor_result_by_input_id, get_processor_result_by_result_id,
    get_result_by_id,
    get_results_by_processor,
    get_results_by_template,
    get_template_by_id
} from "../database/database";
import {create_llm_spec, get_marker_map} from "./utils";

type EvaluationTask = {
    evaluator_id: number;
    llm_spec: LLMSpec;
    markersDict: PromptVarsDict;
    template_value: string;
    result: Result;
}

export class EvaluatorRunner {
    private taskQueue: EvaluationTask[] = [];
    private isProducing = true;
    private errors = 0;
    private pool: workerpool.WorkerPool;
    constructor(
        private experiment_name: string,
        private num_workers: number,
        private node_id: number
    ) {
        this.pool = workerpool.pool(__dirname + '/worker.ts', {
            minWorkers: this.num_workers,
            maxWorkers: this.num_workers,
            workerType: 'thread',
            workerThreadOpts: {
                execArgv: ['--require', 'tsx']
            }
        });
    }

    public async evaluate(){
        await Promise.all([
            this.produceTasks(),
            ...Array.from({ length: this.num_workers }, () => this.taskEvaluator())
        ]);
        await this.pool.terminate();
    }

    public async process(){
        await Promise.all([
            this.produceTasks(),
            ...Array.from({length: this.num_workers }, () => this.taskProcessor())
        ]);
        await this.pool.terminate();
    }

    private async produceTasks(){
        const links = await get_links_by_target(this.node_id);
        for (const link of links){
            const parent_node = await get_node_by_id(link.source_node_id);
            if (parent_node.type === NodeType.dataset){
                // Get the inputs and add them to the task queue
                let input_id = 0;
                const last_id = await get_last_input_id(parent_node.id);
                while (input_id !== last_id) {
                    const input = await get_next_input(parent_node.id, input_id);
                    if (!input) break;

                    input_id = input.id;
                    const markersDict = await get_marker_map(input);
                    const marker = link[0].source_var;
                    const prompt = markersDict[marker];
                    // Check in processor_result if the input is already processed
                    const result = await get_processor_result_by_input_id(input.id, this.node_id);
                    if (result) {
                        // If the input is already processed, skip it
                        continue;
                    }
                    const task: EvaluationTask = {
                        evaluator_id: this.node_id,
                        llm_spec: null,
                        markersDict: null,
                        template_value: null,
                        result: {
                            output_result: prompt,
                            id: undefined,
                            config_id: undefined,
                            input_id: undefined,
                            start_time: undefined,
                            end_time: undefined
                        }
                    }
                    this.taskQueue.push(task);
                }
            }
            else if(parent_node.type === NodeType.prompt_template){
                // Get results by template and add them to the task queue
                const results = await get_results_by_template(parent_node.id.toString());
                const template = await get_template_by_id(parent_node.id);
                const template_value = template.value;
                for (const result of results){
                    // Check if the result is already processed
                    // Get the node to know where to check for the result
                    const node = await get_node_by_id(this.node_id);
                    if (node.type === NodeType.evaluator) {
                        const eval_result = await get_evaluation_result(result.id, this.node_id);
                        if (eval_result) {
                            // If the result is already processed, skip it
                            continue;
                        }
                    }
                    else if (node.type === NodeType.processor) {
                        const processor_result = await get_processor_result_by_result_id(result.id, this.node_id);
                        if (processor_result) {
                            // If the result is already processed, skip it
                            continue;
                        }
                    }
                    const config = await get_config(result.config_id);
                    const llm = await get_llm_by_id(config.LLM_id);
                    const llm_param = await get_llm_param_by_id(config.LLM_param_id);
                    const llm_spec = create_llm_spec(llm, llm_param);
                    const input = await get_input_by_id(result.input_id);
                    const markersDict = await get_marker_map(input);
                    const task: EvaluationTask = {
                        evaluator_id: this.node_id,
                        llm_spec: llm_spec,
                        markersDict: markersDict,
                        template_value: template_value,
                        result: result,
                    }
                    this.taskQueue.push(task);
                }
            }
            else if (parent_node.type === NodeType.processor){
                // Get results from the processor one by one and add them to the task queue
                const processor_results: ProcessorResult[] = await get_results_by_processor(parent_node.id);
                for (const processor_result of processor_results){
                    const node = await get_node_by_id(this.node_id);
                    if (node.type === NodeType.evaluator) {
                        const eval_result = await get_evaluation_result(processor_result.result_id, this.node_id);
                        if (eval_result) {
                            // If the result is already processed, skip it
                            continue;
                        }
                    }
                    else if (node.type === NodeType.processor) {
                        const process_result = await get_processor_result_by_result_id(processor_result.result_id, this.node_id);
                        if (process_result) {
                            // If the result is already processed, skip it
                            continue;
                        }
                    }
                    const result: Result = await get_result_by_id(processor_result.result_id);
                    const config = await get_config(result.config_id);
                    const llm = await get_llm_by_id(config.LLM_id);
                    const llm_param = await get_llm_param_by_id(config.LLM_param_id);
                    const llm_spec = create_llm_spec(llm, llm_param);
                    const input = await get_input_by_id(result.input_id);
                    const markersDict = await get_marker_map(input);
                    const template = await get_template_by_id(config.prompt_template_id);
                    const updated_result = {...result, output_result: processor_result.processor_result}
                    const task: EvaluationTask = {
                        evaluator_id: this.node_id,
                        llm_spec: llm_spec,
                        markersDict: markersDict,
                        template_value: template.value,
                        result: updated_result,
                    }
                    this.taskQueue.push(task);
                }
            }
        }
        this.isProducing = false;
    }

    private async taskEvaluator() {
        while (this.isProducing || this.taskQueue.length > 0) {
            if (this.taskQueue.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                continue;
            }
            const task = this.taskQueue.shift();
            if (!task) continue;

            try {
                const {evaluator_id, llm_spec, markersDict, template_value, result} = task;
                await this.pool.exec('evaluate', [evaluator_id, llm_spec, markersDict, template_value, result]);
            } catch (error) {
                console.error(`Error processing task: ${error.message}`);
                this.errors++;
            }
        }
    }

    private async taskProcessor() {
        while (this.isProducing || this.taskQueue.length > 0) {
            if (this.taskQueue.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                continue;
            }
            const task = this.taskQueue.shift();
            if (!task) continue;

            try {
                const {evaluator_id, llm_spec, markersDict, template_value, result} = task;
                await this.pool.exec('process', [evaluator_id, llm_spec, markersDict, template_value, result]);
            } catch (error) {
                console.error(`Error processing task: ${error.message}`);
                this.errors++;
            }
        }
    }
}