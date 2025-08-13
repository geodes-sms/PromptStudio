import {LLMSpec, PromptVarsDict} from "../typing";
import {Input, Llm_params} from "./types";
import {get_marker_by_id} from "../database/database";

/**
 * Creates a specification for the LLM based on the provided parameters.
 * @param llm The LLMSpec object containing the LLM details.
 * @param llm_param The Llm_params object containing the parameters for the LLM.
 */
export function create_llm_spec(llm: LLMSpec, llm_param: Llm_params): LLMSpec {
    const settings: any = {
        ...(llm_param.max_tokens !== undefined && { max_tokens: llm_param.max_tokens }),
        ...(llm_param.top_p !== undefined && { top_p: llm_param.top_p }),
        ...(llm_param.top_k !== undefined && { top_k: llm_param.top_k }),
        ...(llm_param.stop_sequence !== undefined && { stop_sequence: llm_param.stop_sequence }),
        ...(llm_param.frequency_penalty !== undefined && { frequency_penalty: llm_param.frequency_penalty }),
        ...(llm_param.presence_penalty !== undefined && { presence_penalty: llm_param.presence_penalty }),
        ...llm_param.custom_params,
    };

    return {
        name: llm.name,
        model: llm.model,
        temp: llm_param.temperature,
        base_model: llm.base_model,
        settings,
    };
}

/**
 * Generates a marker map from the input markers.
 * This function retrieves the marker names by their IDs and maps them to their corresponding values.
 * It is used to create a dictionary of markers that can be used in LLM queries.
 * @param input The Input object containing the markers to be processed.
 * @returns A dictionary where the keys are marker names and the values are their corresponding values.
 */
export async function get_marker_map(input: Input) {
    const markersDict: PromptVarsDict = {};
    for (const marker of input.markers) {
        const name = await get_marker_by_id(marker.marker_id);
        markersDict[name] = marker.value;
    }
    return markersDict;
}