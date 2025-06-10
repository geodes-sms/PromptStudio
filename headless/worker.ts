import workerpool from 'workerpool';
import {queryLLM} from "../backend/backend";
import {save_error, save_response} from "./apiCall";
import {LLMSpec, PromptVarsDict} from "../backend/typing";

async function processExperiment(config_id: number, llm_spec: LLMSpec, iterations: number,
                                 template_value: string, markersDict: PromptVarsDict, max_retry: number,
                                 input_id: number, tries = 0): Promise<{success: boolean, tries: number}> {
    const start_time = new Date().toISOString().replace('T', ' ').replace('Z', ' ');
    const responses = await queryLLM(
        config_id.toString(),
        [llm_spec],
        iterations,
        template_value,
        markersDict,
        // TODO Remove hardcoded keys
        {
            OpenAI: "sk-bmbbiv6x1vjlub79148bha2hnz2m2of",
            Google: "AIzaSyCUCsxmHNL8GlBzeDhERyUgMXzYzwgxHJk",
            Anthropic: "sk-8b1c2f3d-4e5f-4a6b-8c9d-0e1f2g3h4i5j",
        });
    const end_time = new Date().toISOString().replace('T', ' ').replace('Z', ' ');
    for (const response of responses.responses) {
        // console.log(response.tokens);
        for (const llm_response of response.responses) {
            await save_response(config_id, llm_response, input_id, start_time, end_time, response.tokens.total_tokens / responses.responses.length);
        }
    }

    if (responses.errors && Object.keys(responses.errors).length > 0){
        for (const key of Object.keys(responses.errors)) {
            for (const err of responses.errors[key]) {
                await save_error(config_id, err.message, err.getStatus(), input_id, start_time, end_time);
                tries++;
                return {success: false, tries: tries};
            }
        }
    }

    return {success: true, tries: tries};


}

workerpool.worker({
    processExperiment: processExperiment
});