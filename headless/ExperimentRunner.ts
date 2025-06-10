import {LLMSpec, PromptVarsDict} from "../backend/typing";
import workerpool from "workerpool";
import {
    get_dataset_by_id,
    get_experiment_by_name, get_last_input_id,
    get_llm_by_id,
    get_llm_param_by_id, get_next_input,
    get_prompt_config_by_experiment, get_results,
    get_template_by_id
} from "./apiCall";
import {create_llm_spec, get_marker_map} from "./utils";

export type Task = {
    config_id: number,
    llm_spec: LLMSpec;
    iterations: number;
    template_value: string;
    markersDict: PromptVarsDict;
    max_retry: number;
    input_id: number;
    tries: number;
}

export class ExperimentRunner {
    private taskQueue: Task[] = [];
    private isProducing = true;
    private errors = 0;

    constructor(
        private experiment_name: string,
        private num_workers: number,
        private bar: ProgressBar,
        private pool: workerpool.WorkerPool
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
        const prompt_configs = await get_prompt_config_by_experiment(experiment.id);

        for (const config of prompt_configs) {
            const llm = await get_llm_by_id(config.LLM_id);
            const llm_param = await get_llm_param_by_id(config.LLM_param_id);
            const template = await get_template_by_id(config.prompt_template_id);
            const dataset = await get_dataset_by_id(config.dataset_id);
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
                if (iterations <= 0) continue;

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
        while (this.isProducing || this.taskQueue.length > 0) {
            const task = this.taskQueue.shift();
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

        if (!result.success && result.tries < experimentMaxRetry) {
            this.taskQueue.push({ ...task, tries: result.tries });
        } else if (!result.success) {
            this.errors++;
            this.bar.tick();
        } else {
            this.bar.tick();
        }
    }
}
