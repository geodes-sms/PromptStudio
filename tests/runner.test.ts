import { run_experiment } from "../backend/api/runner";
import {save_config} from "../headless/apiCall";
import * as workerpool from 'workerpool';
import { ExecOptions} from "workerpool/types/types";
import * as path from "node:path";
import {ExperimentRunner, Task} from "../backend/api/ExperimentRunner";
import {save_response} from "../backend/database/database";


jest.setTimeout(20000);

// To run those tests we need to run api.ts and have a working database
describe("run_experiment", () => {


    beforeEach( () => {
        let pool: workerpool.Pool;
        const workerPath = path.resolve(__dirname, '../backend/api/worker.ts');
        pool = workerpool.pool(workerPath);

        jest.spyOn(pool, 'exec').mockImplementation(
            (method: string | ((...args: any[]) => any), params?: any[], options?: ExecOptions): workerpool.Promise<any> => {
                if (method === 'processExperiment') {
                    return {
                        success: true,
                        tries: params?.[6],
                    } as unknown as workerpool.Promise<any>;
                }
                return workerpool.pool(workerPath).exec(method, params, options) as workerpool.Promise<any>;
            }
        );
        jest.spyOn(ExperimentRunner.prototype as any, 'submitTask').mockImplementation(
            async function (this: ExperimentRunner, task: Task, experimentMaxRetry: number){
                await save_response(task.config_id, `test response ${task.config_id} ${task.input_id}`,
                    task.input_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '),
                    new Date().toISOString().replace('T', ' ').replace('Z', ' '), 0);
                await save_response(task.config_id, `test response ${task.config_id} ${task.input_id} 2`,
                    task.input_id, new Date().toISOString().replace('T', ' ').replace('Z', ' '),
                    new Date().toISOString().replace('T', ' ').replace('Z', ' '), 0);
                return;
            }
        )
    });

    it("run with a real database", async () => {
        const yml = 'files/flow-1747232648249.yml';

        const experiment_name = await save_config(yml);
        expect(experiment_name).toBeDefined();
        await run_experiment(experiment_name, '');
    })

    it("run with processor then evaluator", async () => {
        const yml = 'files/testflow.yml';

        const experiment_name = await save_config(yml);
        expect(experiment_name).toBeDefined();
        await run_experiment(experiment_name, '');
    })

    it("dataset to processor directly", async () => {
        const yml = 'files/datasettoprocessor.yml';
        const experiment_name = await save_config(yml);
        expect(experiment_name).toBeDefined();
        await run_experiment(experiment_name, '');
    })

    it("chain of prompts", async () => {
        const yml = 'files/chainprompts.yml';
        const experiment_name = await save_config(yml);
        expect(experiment_name).toBeDefined();
        await run_experiment(experiment_name, '');
    })

    it("multiple inputs sources for prompt node", async () => {
        const yml = 'files/multipleinputs.yml';
        const experiment_name = await save_config(yml);
        expect(experiment_name).toBeDefined();
        await run_experiment(experiment_name, '');
    })

});