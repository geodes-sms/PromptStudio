import workerpool from 'workerpool';
import {queryLLM} from "../backend/backend";
import {save_error, save_response} from "./apiCall";
import {LLMSpec, PromptVarsDict} from "../backend/typing";

async function processExperiment(config_id: number, llm_spec: LLMSpec, iterations: number,
                                 template_value: string, markersDict: PromptVarsDict, max_retry: number,
                                 input_id: number): Promise<boolean> {
    let tries = 0;

    while (tries <= max_retry) {
        const responses = await queryLLM(
            config_id.toString(),
            [llm_spec],
            iterations,
            template_value,
            markersDict,
            {
                OpenAI: "sk-bmbbiv6x1vjlub79148bha2hnz2m2of",
                Google: "AIzaSyCUCsxmHNL8GlBzeDhERyUgMXzYzwgxHJk",
            }
        );

        for (const response of responses.responses) {
            // console.log(response.tokens);
            for (const llm_response of response.responses) {
                await save_response(config_id, llm_response, input_id);
            }
        }

        if (!responses.errors || Object.keys(responses.errors).length === 0) break;

        for (const key of Object.keys(responses.errors)) {
            for (const err of responses.errors[key]) {
                await save_error(config_id, err.message, err.getStatus(), input_id);
                tries++;
                if (tries >= max_retry) {
                    return false;
                }
            }
        }
    }
    return true;
}

workerpool.worker({
    processExperiment: processExperiment
});