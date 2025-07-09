import workerpool from 'workerpool';
import {queryLLM} from "../backend";
import {
    get_evaluation_result,
    get_evaluators_by_config,
    get_results,
    save_error, save_eval_result,
    save_response
} from "../database/database";
import {Dict, LLMSpec, PromptVarsDict} from "../typing";
import {executejs} from "./evaluator";
import {Result} from "./types";

/**
 * Processes an experiment by querying the LLM with the given parameters and saving the responses.
 * This function is designed to be run in a worker thread, allowing for parallel processing of multiple experiments.
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
    const start_time = new Date().toISOString().replace('T', ' ').replace('Z', ' ');
    const safe_api_keys = JSON.parse(api_keys);
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

    await evaluate(config_id, input_id, llm_spec, markersDict, template_value);

    return {success: true, tries: tries};
}

async function evaluate(config_id: number, input_id: number, LLMSpec: LLMSpec, markersDict: PromptVarsDict, template_value: string) {
    const results = await get_results(config_id, input_id);
    const evaluators = await get_evaluators_by_config(config_id);

    for (const evaluator of evaluators) {
        // Check for each result and for each evalyator if the result is already evaluated
        const results_to_evaluate: Result[] = [];
        for (const result of results) {
            const existingEval = await get_evaluation_result(result.id, evaluator.id);
            if (!existingEval) {
                results_to_evaluate.push(result);
            }
        }
        const eval_results = await executejs(evaluator.code, results_to_evaluate, markersDict, {}, LLMSpec.base_model, template_value, "evaluator");
        if (eval_results.error) {
            await save_error(config_id, eval_results.error, 0, input_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '), new Date().toISOString().replace('T', ' ').replace('Z', ' '));
            continue;
        }
        for (const eval_result of eval_results.responses) {
            if (eval_result.error) {
                await save_error(config_id, eval_result.error, 0, input_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '), new Date().toISOString().replace('T', ' ').replace('Z', ' '));
            } else {
                const result = eval_result.result;
                if (result) {
                    await save_eval_result(result, eval_result.result_id, evaluator.id);
                }
            }
        }
    }
}

workerpool.worker({
    processExperiment: processExperiment,
    evaluate: evaluate,
});