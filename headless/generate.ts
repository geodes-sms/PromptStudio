import * as fs from "fs";
import { readFile } from "fs/promises";
import * as yaml from "js-yaml";
// @ts-ignore
import ProgressBar from "progress";

import {
  Evaluator,
  Llm_params,
  Promptconfig,
  Experiment,
} from "../backend/api/types";
import {
  executejs,
} from "../backend/backend";
import {
  LLMSpec,
  PromptVarsDict,
  LLMResponse,
} from "../backend/typing";
import {
  save_experiment,
  save_promptconfig,
  save_template,
  save_dataset,
  save_llm,
  save_llm_param,
  get_prompt_config_by_experiment,
  get_experiment_by_name,
  get_template_by_name,
  get_llm_by_id,
  get_llm_param_by_id,
  get_template_by_id,
  get_dataset_by_id,
  get_next_input,
  get_last_input_id,
  get_results,
  get_dataset_by_name,
  get_llm_by_base_model,
  get_dataset_size,
  save_evaluator_config,
  save_evaluator,
  get_evaluator_by_name,
  get_results_by_config,
  get_evaluators_by_config,
  get_input_by_id,
  save_combination_as_input,
  get_all_input_ids_from_dataset,
  get_results_by_template,
  update_template_vars,
  save_config_base_dataset,
  get_base_datasets_for_config,
  update_promptconfig_final_dataset,
  get_config,
} from "./apiCall";
import { PromptPermutationGenerator } from "../backend/template";
import {getTokenCount} from "./token";
import * as path from "node:path";
import workerpool from "workerpool";
import {ExperimentRunner} from "./ExperimentRunner";
import {create_llm_spec, get_marker_map} from "./utils";

function hasCycle(graph: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(node: string): boolean {
    if (!visited.has(node)) {
      visited.add(node);
      recStack.add(node);

      for (const neighbor of graph.get(node) || []) {
        if (!graph.has(neighbor)) {
          throw new Error(`Template dependency error: '${node}' depends on unknown template '${neighbor}'`);
        }

        if (!visited.has(neighbor) && dfs(neighbor)) {
          return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }
    }
    recStack.delete(node);
    return false;
  }

  // @ts-ignore
  for (const node of graph.keys()) {
    if (dfs(node)) {
      return true;
    }
  }

  return false;
}

export async function save_config(yml_file: string) {
  try {
    const file = fs.readFileSync(yml_file, "utf8");
    const parsed: any = yaml.load(file);

    let experimentName = parsed.experiment.title;
    let counter = 1;
    let existingExperiment = await get_experiment_by_name(experimentName);

    while (existingExperiment) {
      experimentName = `${parsed.experiment.title}_${counter++}`;
      existingExperiment = await get_experiment_by_name(experimentName);
    }

    const experiment_id = await save_experiment({
      ...parsed.experiment,
      title: experimentName,
    });

    const templateIdByName = new Map<string, number>();

    // Build dependency graph for templates
    const templateDeps = new Map<string, string[]>();

    for (const config of parsed.configs) {
      const templateName = config.template.name;

      if (config.template.vars && Object.keys(config.template.vars).length > 0) {
        const deps: string[] = Object.values(config.template.vars);
        templateDeps.set(templateName, deps);
      } else {
        templateDeps.set(templateName, []);
      }
    }

    if (hasCycle(templateDeps)) {
      throw new Error("Invalid YAML: cyclic dependency detected between templates!");
    }

    // Pass 1: save all templates
    for (const config of parsed.configs) {
      const template = config.template.value;
      let templateName = config.template.name;
      let templateCounter = 1;

      let existingTemplate = await get_template_by_name(templateName);
      while (existingTemplate) {
        templateName = `${config.template.name}_${templateCounter++}`;
        existingTemplate = await get_template_by_name(templateName);
      }

      const template_id = await save_template(template, templateName, {}); // Save empty vars because some of them might not exist yet
      templateIdByName.set(config.template.name, template_id);
    }

    // Pass 2: save configs
    for (const config of parsed.configs) {
      const template_id = templateIdByName.get(config.template.name);

      // Update the vars for all templates since all template have been created
      await update_template_vars(template_id, config.template.vars);

      const evaluators_id: number[] = [];
      if (config.evaluators) {
        for (const evaluator of config.evaluators as Evaluator[]) {
          const existing = await get_evaluator_by_name(evaluator.name);
          const evaluator_id = existing
              ? existing.id
              : await save_evaluator({
                ...evaluator,
                code: await readFile(evaluator.file, "utf8"),
              });
          evaluators_id.push(evaluator_id);
        }
      }

      for (const llm of config.llms as LLMSpec[]) {
        const existingLLM = await get_llm_by_base_model(llm.base_model);
        const llm_id = existingLLM ? existingLLM.id : await save_llm(llm);

        const llm_params: Partial<Llm_params> = {};
        const custom_params: Record<string, string> = {};
        const knownparams = [
          "max_tokens",
          "top_p",
          "top_k",
          "stop_sequence",
          "frequency_penalty",
          "presence_penalty",
        ];
        const nativeProps = [
          "name",
          "model",
          "temp",
          "base_model",
          "settings",
          "emoji",
          "key",
        ];

        if (llm.temp !== undefined) llm_params.temperature = llm.temp;

        for (const [key, value] of Object.entries(llm)) {
          if (knownparams.includes(key)) llm_params[key] = value;
          else if (!nativeProps.includes(key) && value !== undefined)
            custom_params[key] = String(value);
        }

        if (Object.keys(custom_params).length > 0) {
          llm_params.custom_params = custom_params;
        }

        const llm_param_id = await save_llm_param(llm_params);

        const final_dataset_id = null;
        const config_id = await save_promptconfig(
            experiment_id,
            llm_id,
            llm_param_id,
            template_id,
            final_dataset_id
        );

        if (config.datasets && Array.isArray(config.datasets)) {
          for (const dataset of config.datasets) {
            const existingDataset = await get_dataset_by_name(dataset.name);
            const dataset_id = existingDataset
                ? existingDataset.id
                : await save_dataset(dataset.path, dataset.name, template_id);

            await save_config_base_dataset(config_id, dataset_id);
          }
        }

        for (const evaluator_id of evaluators_id) {
          await save_evaluator_config(evaluator_id, config_id);
        }
      }
    }
    return experimentName;
  } catch (error) {
    console.error(error);
  }
}

export async function get_number_of_total_inputs(prompt_configs: Promptconfig[]) {
  let total_inputs = 0;
  for (const config of prompt_configs) {
    const updated_config = await get_config(config.id);
    if (updated_config.final_dataset_id) {
      total_inputs += await get_dataset_size(updated_config.final_dataset_id);
    }
  }
  return total_inputs;
}

export async function evaluate_experiment(experiment_name: string) {
  try {
    const experiment = await get_experiment_by_name(experiment_name);
    const prompt_configs = await get_prompt_config_by_experiment(experiment.id);

    for (const config of prompt_configs) {
      const results = await get_results_by_config(config.id);
      const evaluators = await get_evaluators_by_config(config.id);
      const llm = await get_llm_by_id(config.LLM_id);
      const llm_param = await get_llm_param_by_id(config.LLM_param_id);
      const llm_spec = create_llm_spec(llm, llm_param);

      for (const result of results) {
        const input = await get_input_by_id(result.input_id);
        const markersDict = await get_marker_map(input);
        const prompt_template = await get_template_by_id(config.prompt_template_id);
        const gen = new PromptPermutationGenerator(prompt_template.value);
        const prompt = gen.generate(markersDict).next().value.toString();

        for (const evaluator of evaluators) {
          const response: LLMResponse = {
            responses: [result.output_result],
            prompt,
            vars: markersDict,
            metavars: {},
            llm: llm_spec,
            uid: "",
          };

          const eval_result = await executejs("0", evaluator.code, [response], "response", "evaluator");
          // console.log(eval_result);
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function prepare_config(experiment: Experiment, config: Promptconfig, deps: Record<string, string>) {
  const base_datasets = await get_base_datasets_for_config(config.id);

  const datasets = [];
  for (const ds of base_datasets) {
    const dataset = await get_dataset_by_id(ds);
    if (dataset) datasets.push(dataset);
  }

  const datasetIds = base_datasets.map(d => d).sort((a,b) => a - b).join('_');

  const synthetic_dataset_name = `synth_${experiment.title}_template${config.prompt_template_id}_datasets${datasetIds}`;

  let synthetic_dataset = await get_dataset_by_name(synthetic_dataset_name);

  let synthetic_dataset_id: number;

  if (synthetic_dataset) {
    synthetic_dataset_id = synthetic_dataset.id;
  } else {
    synthetic_dataset_id = await save_dataset(synthetic_dataset_name, synthetic_dataset_name, config.prompt_template_id);
  }

  await update_promptconfig_final_dataset(config.id, synthetic_dataset_id);

  const datasetInputs: PromptVarsDict[][] = [];

  for (const ds of datasets) {
    const inputIds = await get_all_input_ids_from_dataset(ds.id);
    const markersForDataset: PromptVarsDict[] = [];

    for (const input_id of inputIds) {
      const input = await get_input_by_id(input_id);
      const markers = await get_marker_map(input);
      markersForDataset.push(markers);
    }

    datasetInputs.push(markersForDataset);
  }

  const productOfInputs = cartesianProduct(datasetInputs);

  for (const baseMarkersList of productOfInputs) {
    const mergedBaseMarkers = Object.assign({}, ...baseMarkersList);

    let combinations: PromptVarsDict[] = [{}];
    for (const [varName, template_id] of Object.entries(deps)) {
      const results = await get_results_by_template(template_id);
      const newCombinations: PromptVarsDict[] = [];
      for (const combo of combinations) {
        for (const result of results) {
          newCombinations.push({ ...combo, [varName]: result.output_result });
        }
      }
      combinations = newCombinations;
    }

    for (const combo of combinations) {
      const fullMarkers = { ...combo, ...mergedBaseMarkers };
      await save_combination_as_input(synthetic_dataset_id, config.id, fullMarkers);
    }
  }
}


export async function run_experiment(experiment_name: string) {
  try {
    const experiment = await get_experiment_by_name(experiment_name);
    const prompt_configs = await get_prompt_config_by_experiment(experiment.id);

    const independent: Promptconfig[] = [];
    const dependent: Promptconfig[] = [];

    const dependenciesByConfigId = new Map<number, Record<string, string>>();
    const configById = new Map<number, Promptconfig>();

    const synthetic_done = new Set<string>();

    for (const config of prompt_configs) {
      const template = await get_template_by_id(config.prompt_template_id);
      configById.set(config.id, config);

      const base_datasets = await get_base_datasets_for_config(config.id);

      if (template.vars && Object.keys(template.vars).length > 0) {
        dependent.push(config);
        dependenciesByConfigId.set(config.id, template.vars);
      } else if (base_datasets.length === 1) {
        await update_promptconfig_final_dataset(config.id, base_datasets[0]);
        independent.push(config);
      } else if (base_datasets.length > 1) {
        const datasetIds = base_datasets.map(d => d).sort((a,b) => a - b).join('_');
        const synthetic_key = `template${config.prompt_template_id}_datasets${datasetIds}`;

        const synthetic_dataset_name = `synth_${experiment.title}_template${config.prompt_template_id}_datasets${datasetIds}`;

        let synthetic_dataset = await get_dataset_by_name(synthetic_dataset_name);
        let synthetic_dataset_id: number;

        if (synthetic_dataset) {
          synthetic_dataset_id = synthetic_dataset.id;
        } else {
          if (!synthetic_done.has(synthetic_key)) {
            await prepare_config(experiment, config, {});
            synthetic_done.add(synthetic_key);
          }

          synthetic_dataset = await get_dataset_by_name(synthetic_dataset_name);
          synthetic_dataset_id = synthetic_dataset.id;
        }

        await update_promptconfig_final_dataset(config.id, synthetic_dataset_id);
        independent.push(config);
      } else {
        console.warn(`Config ${config.id}: no datasets found! Skipping`);
      }
    }

    await run_configs(experiment, independent);

    const doneTemplates = new Set<number>();
    for (const config of independent) {
      const template = await get_template_by_id(config.prompt_template_id);
      doneTemplates.add(template.id);
    }

    const remaining = new Set(dependent.map((cfg) => cfg.id));
    let progress = true;

    while (remaining.size > 0 && progress) {
      progress = false;

      for (const configId of Array.from(remaining)) {
        const config = configById.get(configId)!;
        const deps = dependenciesByConfigId.get(config.id)!;
        const depTemplateIds = Object.values(deps).map((x) => Number(x));

        const depsSatisfied = depTemplateIds.every((depId) => doneTemplates.has(depId));

        if (depsSatisfied) {
          console.log(`Running config ${config.id} after dependencies satisfied.`);

          await prepare_config(experiment, config, deps);
          await run_configs(experiment, [config]);

          const template = await get_template_by_id(config.prompt_template_id);
          doneTemplates.add(template.id);
          remaining.delete(config.id);
          progress = true;
        }
      }

      if (!progress && remaining.size > 0) {
        console.error(
            "Cyclic or unsatisfiable dependencies detected! Remaining configs:",
            Array.from(remaining)
        );
        throw new Error("Dependency resolution failed — cannot run experiment.");
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function run_configs(experiment: Experiment, configs: Promptconfig[]) {
  const total = await get_number_of_total_inputs(configs);
  const bar = new ProgressBar("Processing LLM calls: [:bar] :percent :etas", { total });

  const num_workers = experiment.threads || 1;
  const pool = workerpool.pool(path.resolve(__dirname, 'worker.ts'), {
    minWorkers: num_workers,
    maxWorkers: num_workers,
    workerType: "thread",
    workerThreadOpts: {
      execArgv: ['--require', 'tsx']
    },
  });

  const runner = new ExperimentRunner(experiment.title, num_workers, bar, pool, configs);
  await runner.run();
}

export async function getTotalTokenCountForExperiment(experimentName: string): Promise<number> {
  try {
    const experiment = await get_experiment_by_name(experimentName);
    const prompt_configs: Promptconfig[] = await get_prompt_config_by_experiment(experiment.id);
    let totalTokens = 0;

    for (const config of prompt_configs) {
      if (!config.final_dataset_id) {
        continue;
      }
      const dataset = await get_dataset_by_id(config.final_dataset_id);
      const llm = await get_llm_by_id(config.LLM_id);
      const llm_param = await get_llm_param_by_id(config.LLM_param_id);
      const template = await get_template_by_id(config.prompt_template_id);
      const model = llm.base_model;

      let input_id = 0;
      const last_id = await get_last_input_id(dataset.id);

      while (input_id !== last_id) {
        const input = await get_next_input(dataset.id, input_id);
        if (!input) break;

        input_id = input.id;
        const results = await get_results(config.id, input_id);

        let remainingIterations = experiment.iterations;

        if (results && results.length > 0) {
          remainingIterations -= results.length;
        }
        if (remainingIterations <= 0) {
          continue;
        }

        const markersDict = await get_marker_map(input);
        const generator = new PromptPermutationGenerator(template.value);
        const prompt = generator.generate(markersDict).next().value.toString();

        const tokenCount = getTokenCount(model, prompt);
        totalTokens += tokenCount * remainingIterations;
      }
    }

    return totalTokens;
  } catch (error) {
    console.error("Error computing total token count:", error);
    return 0;
  }
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
      (acc, curr) =>
          acc.flatMap(a => curr.map(b => [...a, b])),
      [[]]
  );
}
