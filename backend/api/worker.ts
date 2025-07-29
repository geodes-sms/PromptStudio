// @ts-ignore
import workerpool from 'workerpool';
import {queryLLM} from "../backend";
import {
    get_evaluator_by_id, get_processor_by_id,
    save_error, save_error_evaluator, save_error_processor, save_eval_result, save_process_result,
    save_response
} from "../database/database";
import {Dict, LLMSpec, PromptVarsDict} from "../typing";
import {executejs} from "./evaluator";
import {ExperimentProcessor, Result} from "./types";

/**
 * Processes an experiment by querying the LLM with the given parameters and saving the responses.
 * This function is designed to be run in a worker thread, allowing for parallel processing.
 * @param config_id The ID of the configuration to use for the experiment.
 * @param llm_spec The specification of the LLM to use for the experiment.
 * @param iterations The number of iterations to run the experiment for.
 * @param template_value The template value to use for the LLM query.
 * @param markersDict A dictionary of markers to use in the LLM query.
 * @param input_id The ID of the input to use for the experiment.
 * @param tries The current number of tries for the experiment, used for retry logic.
 * @param api_keys A dictionary of API keys to use for the LLM query.
 */
async function processExperiment(config_id: number, llm_spec: LLMSpec, iterations: number,
                                 template_value: string, markersDict: PromptVarsDict,
                                 input_id: number, api_keys: Dict<string>, tries: number = 0 ): Promise<{success: boolean, tries: number}> {
    // @ts-ignore
    const safe_api_keys = JSON.parse(api_keys);
    const start_time = new Date().toISOString().replace('T', ' ').replace('Z', ' ');
    const responses = await queryLLM(
        config_id.toString(),
        [llm_spec],
        iterations,
        template_value,
        markersDict,
        safe_api_keys);
    const end_time = new Date().toISOString().replace('T', ' ').replace('Z', ' ');
    for (const response of responses.responses) {
        for (const llm_response of response.responses) {
            await save_response(config_id, llm_response, input_id, start_time, end_time, response.tokens.total_tokens / responses.responses.length);
        }
    }
    if (responses.errors && Object.keys(responses.errors).length > 0){
        for (const key of Object.keys(responses.errors)) {
            for (const err of responses.errors[key]) {
                await save_error(config_id, err.message, err.getStatus() || 0, input_id, start_time, end_time);
                tries++;
                return {success: false, tries: tries};
            }
        }
    }
    return {success: true, tries: tries};
}

async function evaluate(evaluator_id: number, LLMSpec: LLMSpec, markersDict: PromptVarsDict, template_value: string, result: Result) {
    const evaluator = await get_evaluator_by_id(evaluator_id);
    const eval_result = await executejs(evaluator.code, result, markersDict, {}, LLMSpec.base_model, template_value, "evaluator");
    // Check if there is an error in the evaluator itself
    if (eval_result.error) {
        await save_error_evaluator(evaluator.node_id, eval_result.error, result.id, new Date().toISOString().replace('T', ' ').replace('Z', ' '),);
        return;
    }
    // Check if there is an error in the evaluation result
    if (eval_result.response.error) {
        await save_error_evaluator(evaluator.node_id, eval_result.response.error, eval_result.response.result_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '));
    } else {
        const result = eval_result.response.result;
        if (result) {
            await save_eval_result(result, eval_result.response.result_id, evaluator.node_id);
        }
    }
}

async function process(processor_id: number, LLMSpec: LLMSpec,  markersDict: PromptVarsDict, template_value: string, result: Result, input_id: number) {
    const processor: ExperimentProcessor = await get_processor_by_id(processor_id);
    const process_result = await executejs(processor.code, result, markersDict, {}, LLMSpec.base_model, template_value, "processor");
    // Check if there is an error in the processor itself
    if (process_result.error) {
        await save_error_processor(processor.node_id, process_result.error, result.id, input_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '),);
        return;
    }
    // Check if there is an error in the process result
    if (process_result.response.error) {
        await save_error_processor(processor.node_id, process_result.response.error, process_result.response.result_id, input_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '));
    } else {
        const result = process_result.response.result;
        if (result) {
            await save_process_result(result, process_result.response.result_id, processor.node_id, input_id);
        }
    }
}

workerpool.worker({
    processExperiment: processExperiment,
    evaluate: evaluate,
    process: process,
});