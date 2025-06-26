import { LLMSpec, PromptVarsDict } from "../backend/typing";
import workerpool from "workerpool";
import {
    get_config,
    get_dataset_by_id,
    get_experiment_by_name,
    get_last_input_id,
    get_llm_by_id,
    get_llm_param_by_id,
    get_next_input,
    get_results,
    get_template_by_id
} from "./apiCall";
import { create_llm_spec, get_marker_map } from "./utils";
import { Promptconfig } from "../backend/api/types";

export type Task = {
    config_id: number;
    llm_spec: LLMSpec;
    iterations: number;
    template_value: string;
    markersDict: PromptVarsDict;
    max_retry: number;
    input_id: number;
    tries: number;
};

export class ExperimentRunner {
    private taskQueue: Task[] = [];
    private failedQueue: Map<number, Task[]> = new Map();
    private isProducing = true;
    private errors = 0;

    constructor(
        private experiment_name: string,
        private num_workers: number,
        private bar: ProgressBar,
        private pool: workerpool.WorkerPool,
        private configs: Promptconfig[]
    ) {}

    async run() {
        await Promise.all([
            this.produceTasks(),
            ...Array.from({ length: this.num_workers }, () => this.taskRunner())
        ]);
        await this.pool.terminate();

        if (this.errors > 0) {
            console.error(`Experiment "${this.experiment_name}" completed with ${this.errors} errors.`);
        } else {
            console.log(`Experiment "${this.experiment_name}" completed successfully.`);
        }
    }

    private async produceTasks() {
        const experiment = await get_experiment_by_name(this.experiment_name);

        for (const config of this.configs) {
            const updatedConfig = await get_config(config.id);
            const llm = await get_llm_by_id(updatedConfig.LLM_id);
            const llm_param = await get_llm_param_by_id(updatedConfig.LLM_param_id);
            const template = await get_template_by_id(updatedConfig.prompt_template_id);
            const dataset = await get_dataset_by_id(updatedConfig.final_dataset_id);
            const llm_spec = create_llm_spec(llm, llm_param);

            let input_id = 0;
            const last_id = await get_last_input_id(dataset.id);

            while (input_id !== last_id) {
                const input = await get_next_input(dataset.id, input_id);
                if (!input) break;

                input_id = input.id;
                const markersDict = await get_marker_map(input);

                let iterations = experiment.iterations;
                const existing = await get_results(config.id, input_id);
                if (existing?.length) iterations -= existing.length;
                if (iterations <= 0) {
                    this.bar.tick();
                    continue;
                }

                this.taskQueue.push({
                    config_id: config.id,
                    llm_spec,
                    iterations,
                    template_value: template.value,
                    markersDict,
                    max_retry: experiment.max_retry,
                    input_id,
                    tries: 0
                });

                while (this.taskQueue.length > 1000) {
                    await new Promise((res) => setTimeout(res, 50));
                }
            }
        }

        this.isProducing = false;
    }

    private async taskRunner() {
        const experiment = await get_experiment_by_name(this.experiment_name);
        while (this.isProducing || this.taskQueue.length > 0 || this.failedQueue.size > 0) {
            let task: Task | undefined;

            // Prioritize main queue
            if (this.taskQueue.length > 0) {
                task = this.taskQueue.shift();
            } else if (!this.isProducing && this.failedQueue.size > 0) {
                // find the lowest available tries bucket
                const sortedTries = Array.from(this.failedQueue.keys()).sort((a, b) => a - b);
                for (const tries of sortedTries) {
                    const bucket = this.failedQueue.get(tries);
                    if (bucket && bucket.length > 0) {
                        task = bucket.shift();
                        if (bucket.length === 0) {
                            this.failedQueue.delete(tries);
                        }
                        break;
                    }
                }
            }

            if (!task) {
                await new Promise((res) => setTimeout(res, 50));
                continue;
            }
            await this.submitTask(task, experiment.max_retry);
        }
    }

    private async submitTask(task: Task, experimentMaxRetry: number) {
        const result = await this.pool.exec('processExperiment', [
            task.config_id,
            task.llm_spec,
            task.iterations,
            task.template_value,
            task.markersDict,
            task.max_retry,
            task.input_id,
            task.tries
        ]);

        if (!result.success && result.tries <= experimentMaxRetry) {
            // Push to failed queue, organized by tries
            const triesBucket = this.failedQueue.get(result.tries) ?? [];
            triesBucket.push({ ...task, tries: result.tries });
            this.failedQueue.set(result.tries, triesBucket);
        } else if (!result.success) {
            this.errors++;
            this.bar.tick();
        } else {
            this.bar.tick();
        }
    }
}