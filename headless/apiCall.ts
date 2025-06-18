import axios from "axios";
import {
    Data_input,
    Dataset,
    Evaluator,
    Experiment, Input,
    Llm_params,
    Promptconfig,
    prompttemplate,
    Result
} from "../backend/api/types";
// @ts-ignore
import FormData from 'form-data';
// @ts-ignore
import fs from 'fs';
import {LLMSpec, PromptVarsDict} from "../backend/typing";
import {PassThrough} from "node:stream";

const URL = "http://localhost:3000";

export async function save_dataset(path: string, name: string, template_id: number): Promise<number>{
    try{
        const formData = new FormData();
        if (path && fs.existsSync(path)) {
            await formData.append('file', fs.createReadStream(path));
        }
        else{
            const emptyStream = new PassThrough();
            emptyStream.end();
            formData.append('file', emptyStream, { filename: 'empty.csv' });
        }
        const response = await axios.post(`${URL}/dataset/${name}/${template_id}`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });
        return response.data.dataset_id;
    }
    catch (error) {
        return;
    }
}

export async function get_prompt_config_by_experiment(experiment_id: number): Promise<Promptconfig[]>{
    try{
        const response = await axios.get(`${URL}/promptconfig`, {
            params: {
                experiment: experiment_id
            }
        });
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function save_promptconfig(experiment_id: number, llm_id: number, llm_param_id: number, template_id: number, dataset_id: number): Promise<number>{
    try{
        const response = await axios.post(`${URL}/promptconfig`, {
            experiment_id,
            llm_id,
            llm_param_id,
            template_id,
            dataset_id
        });
        return response.data.config_id;
    }
    catch (error) {
        return;
    }
}

export async function save_template(template: string, name: string, vars?: Record<string, string>): Promise<number>{
    try{
        const response = await axios.post(`${URL}/template`, {
            template,
            name,
            vars
        });
        return response.data.template_id;
    }
    catch (error) {
        return;
    }
}

export async function get_experiment_by_name(name: string): Promise<Experiment>{
    try{
        const response = await axios.get(`${URL}/experiment/${name}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function save_experiment(experiment: Experiment): Promise<number>{
    try{
        const response = await axios.post(`${URL}/experiment`, {
            experiment
        });
        return response.data.experiment_id;
    }
    catch (error) {
        return;
    }
}

export async function get_llm_by_id(id: number): Promise<LLMSpec>{
    try{
        const response = await axios.get(`${URL}/llm/${id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_llm_param_by_id(id: number): Promise<Llm_params>{
    try{
        const response = await axios.get(`${URL}/llm_param/${id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function save_llm(llm: LLMSpec): Promise<number>{
    try{
        const response = await axios.post(`${URL}/llm`, {
            llm
        });
        return response.data.llm_id;
    }
    catch (error) {
        return;
    }
}

export async function save_llm_param(llm_param: Partial<Llm_params>): Promise<number>{
    try{
        const response = await axios.post(`${URL}/llm_param`, {
            llm_param
        });
        return response.data.llm_param_id;
    }
    catch (error) {
        return;
    }
}

export async function get_template_by_name(name: string): Promise<prompttemplate>{
    try{
        const response = await axios.get(`${URL}/template/name/${name}`);
        return response.data;
    }
    catch (error) {
        return null;
    }
}

export async function get_template_by_id(id: number): Promise<prompttemplate>{
    try{
        const response = await axios.get(`${URL}/template/${id}`);
        return response.data;
    }
    catch (error) {
        return null;
    }
}

export async function get_dataset_by_id(id: number): Promise<Dataset>{
    try{
        const response = await axios.get(`${URL}/dataset/${id}`);
        return response.data;
    }
    catch (error) {
        return null;
    }
}

export async function get_dataset_by_name(name: string): Promise<Dataset>{
    try{
        const response = await axios.get(`${URL}/dataset/name/${name}`);
        return response.data;
    }
    catch (error) {
        return null;
    }
}

export async function get_next_input(dataset_id: number, input_id: number): Promise<Input>{
    try{
        const response = await axios.get(`${URL}/input/${dataset_id}/${input_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_marker_by_id(id: number): Promise<any>{
    try{
        const response = await axios.get(`${URL}/marker/${id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function save_response(config_id: number, llm_response: string, input_id: number, start_time: string, end_time: string, total_tokens: number): Promise<number>{
    try{
        const response = await axios.post(`${URL}/result`, {
            config_id,
            output_result: llm_response,
            input_id,
            start_time,
            end_time,
            total_tokens
        });
        return response.data.response_id;
    }
    catch (error) {
        return;
    }
}

export async function get_last_input_id(dataset_id: number): Promise<number>{
    try{
        const response = await axios.get(`${URL}/last_input/${dataset_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function save_error(config_id: number, error_message: string, error_status: number, input_id: number, start_time: string, end_time: string): Promise<number>{
    try{
        const response = await axios.post(`${URL}/error`, {
            config_id,
            error_message,
            error_status,
            input_id,
            start_time,
            end_time
        });
        return response.data.error_id;
    }
    catch (error) {
        return;
    }
}

export async function get_results(config_id: number, input_id: number): Promise<Result[]>{
    try{
        const response = await axios.get(`${URL}/results`, {
            params: {
                config_id: config_id,
                input_id: input_id
            }
        });
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_llm_by_base_model(base_model: string): Promise<any>{
    try{
        const response = await axios.get(`${URL}/llm/base_model/${base_model}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_dataset_size(dataset_id: number): Promise<number>{
    try{
        const response = await axios.get(`${URL}/dataset/size/${dataset_id}`);
        return response.data.size;
    }
    catch (error) {
        return 0;
    }
}

export async function save_evaluator_config(evaluator_id: number, config_id: number) {
    try{
        const response = await axios.post(`${URL}/evaluator_config`, {
            evaluator_id: evaluator_id,
            config_id: config_id
        });
        return response.data.evaluator_config_id;
    }
    catch (error) {
        return;
    }
}

export async function save_evaluator(evaluator: Evaluator): Promise<number>{
    try{
        const response = await axios.post(`${URL}/evaluator`, {
            evaluator
        });
        return response.data.evaluator_id;
    }
    catch (error) {
        return;
    }
}

export async function get_evaluator_by_name(name: string): Promise<Evaluator>{
    try{
        const response = await axios.get(`${URL}/evaluator/${name}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_results_by_config(config_id: number): Promise<Result[]>{
    try{
        const response = await axios.get(`${URL}/results/config/${config_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_evaluators_by_config(config_id: number): Promise<Evaluator[]>{
    try{
        const response = await axios.get(`${URL}/evaluator/config/${config_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_input_by_id(input_id: number): Promise<Input>{
    try{
        const response = await axios.get(`${URL}/input/${input_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function update_promptconfig_dataset(config_id: number, synthetic_dataset_id: number){
    try{
        const response = await axios.put(`${URL}/promptconfig/${config_id}`, {
            dataset_id: synthetic_dataset_id
        });
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function save_combination_as_input(dataset_id: number, config_id: number, markers: PromptVarsDict){
    try{
        const response = await axios.post(`${URL}/input/combination`, {
            dataset_id,
            config_id,
            markers
        });
        return response.data.input_id;
    }
    catch (error) {
        return;
    }
}

export async function get_all_input_ids_from_dataset(dataset_id: number){
    try{
        const response = await axios.get(`${URL}/inputs/${dataset_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}

export async function get_or_create_synthetic_dataset(base_name:string, dependencies: string[]){
    try{
        const response = await axios.post(`${URL}/dataset/synthetic`, {
            params: {
                base_name,
                dependencies
            }
        });
        return response.data.dataset_id;
    }
    catch (error) {
        return;
    }
}

export async function get_results_by_template(template_id: string): Promise<Result[]>{
    try{
        const response = await axios.get(`${URL}/results/template/${template_id}`);
        return response.data;
    }
    catch (error) {
        return [];
    }
}

export async function get_config(config_id: number): Promise<Promptconfig> {
    try{
        const response = await axios.get(`${URL}/promptconfig/${config_id}`);
        return response.data;
    }
    catch (error) {
        return;
    }
}