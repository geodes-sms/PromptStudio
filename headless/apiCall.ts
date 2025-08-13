import axios from "axios";

import * as FormData from 'form-data';

import * as fs from 'fs';
import * as yaml from "js-yaml";
import * as path from "node:path";
import Dict = NodeJS.Dict;

const URL = "http://localhost:3000";

/**
 * Saves a configuration file to the server.
 * This function reads a YAML configuration file, extracts datasets and evaluators files, and uploads them along with the configuration file itself.
 * @param configPath path to the YAML configuration file.
 */
export async function save_config(configPath: string): Promise<string | undefined> {
    try {
        if (!configPath || !fs.existsSync(configPath)) {
            throw new Error(`Missing or invalid config file: ${configPath}`);
        }

        const fileContent = fs.readFileSync(configPath, "utf-8");
        const parsed = yaml.load(fileContent) as any;

        const formData = new FormData();

        formData.append("yaml", fs.createReadStream(configPath), {
            filename: path.basename(configPath),
        });

        const fileFields = new Map<string, string>();

        for (const node of parsed.nodes){
            if (node.dataset){
                const datasetPath = node.dataset.path;
                const key = `file:${datasetPath}`;
                if (!fileFields.has(key) && fs.existsSync(datasetPath)) {
                    fileFields.set(key, datasetPath);
                }
            }
            if (node.evaluator){
                const evaluatorPath = node.evaluator.file;
                const key = `evaluator:${evaluatorPath}`;
                if (!fileFields.has(key) && fs.existsSync(evaluatorPath)) {
                    fileFields.set(key, evaluatorPath);
                }
            }
            if (node.processor){
                const processorPath = node.processor.file;
                const key = `processor:${processorPath}`;
                if (!fileFields.has(key) && fs.existsSync(processorPath)) {
                    fileFields.set(key, processorPath);
                }
            }
        }
        // @ts-ignore
        for (const [fieldName, filePath] of fileFields.entries()) {
            formData.append(fieldName, fs.createReadStream(filePath), {
                filename: path.basename(filePath),
            });
        }
        const response = await axios.post(`${URL}/config`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });
        return response.data.experiment_name;
    } catch (error) {
        console.error("Failed to save config:", error);
    }
}

/**
 * Runs an experiment by its name using the API.
 * @param name The name of the experiment to run.
 * @param api_keys A dictionary of API keys to use for the experiment.
 */
export async function run_experiment(name: string, api_keys: Dict<any>): Promise<void> {
    try {
        const response = await axios.get(`${URL}/run_experiment/${name}`,
            {
                params: {
                    api_keys: api_keys
                }
            });
        console.log(`Experiment ${name} started successfully.`);
    } catch (error) {
        console.error(`Failed to run experiment ${name}:`, error);
    }
}

/**
 * Gets the total token count for a specific experiment.
 * @param experiment_name The name of the experiment to get the token count for.
 * @returns The total token count for the experiment.
 */
export async function getTotalTokenCountForExperiment(experiment_name: string): Promise<number> {
    try {
        const response = await axios.get(`${URL}/total_tokens/${experiment_name}`);
        return response.data.total_tokens;
    } catch (error) {
        console.error(`Failed to get total token count for experiment ${experiment_name}:`, error);
        return 0;
    }
}