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
  update_promptconfig_dataset,
  save_combination_as_input,
  get_all_input_ids_from_dataset,
  get_or_create_synthetic_dataset, get_results_by_template, get_config,
} from "./apiCall";
import { PromptPermutationGenerator } from "../backend/template";
import {getTokenCount} from "./token";
import * as path from "node:path";
import workerpool from "workerpool";
import {ExperimentRunner} from "./ExperimentRunner";
import {create_llm_spec, get_marker_map} from "./utils";

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

    for (const config of parsed.configs) {
      const template = config.template.value;
      let templateName = config.template.name;
      let templateCounter = 1;

      const evaluators_id: number[] = [];
      if (config.evaluators) {
        for (const evaluator of config.evaluators as Evaluator[]) {
          const existing = await get_evaluator_by_name(evaluator.name);
          if (existing) {
            evaluators_id.push(existing.id);
          } else {
            evaluator.code = await readFile(evaluator.file, "utf8");
            const evaluator_id = await save_evaluator(evaluator);
            evaluators_id.push(evaluator_id);
          }
        }
      }

      let existingTemplate = await get_template_by_name(templateName);
      while (existingTemplate) {
        templateName = `${config.template.name}_${templateCounter++}`;
        existingTemplate = await get_template_by_name(templateName);
      }

      const template_id = await save_template(template, templateName, config.template.vars);

      let dataset_id: number;
      if (config.dataset) {
        const dataset = config.dataset;
        const existingDataset = await get_dataset_by_name(dataset.name);
        dataset_id = existingDataset
            ? existingDataset.id
            : await save_dataset(dataset.path, dataset.name, template_id);
      } else {
        dataset_id = null;
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
        const config_id = await save_promptconfig(
            experiment_id,
            llm_id,
            llm_param_id,
            template_id,
            dataset_id
        );

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

async function get_number_of_total_inputs(prompt_configs: Promptconfig[]) {
  let total_inputs = 0;
  for (const config of prompt_configs) {
    const updatedConfig = await get_config(config.id);
    total_inputs += await get_dataset_size(updatedConfig.dataset_id);
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

export async function run_experiment(experiment_name: string) {
  try {
    const experiment = await get_experiment_by_name(experiment_name);
    const prompt_configs = await get_prompt_config_by_experiment(experiment.id);

    // Group configs
    const independent: Promptconfig[] = [];
    const dependent: Promptconfig[] = [];

    const dependenciesByConfigId = new Map<number, Record<string, string>>();

    for (const config of prompt_configs) {
      const template = await get_template_by_id(config.prompt_template_id);
      if (template.vars && Object.keys(template.vars).length > 0) {
        dependent.push(config);
        dependenciesByConfigId.set(config.id, template.vars);
      } else {
        independent.push(config);
      }
    }

    await run_configs(experiment, independent);

    for (const config of dependent) {
      const deps = dependenciesByConfigId.get(config.id)!;
      const dataset = await get_dataset_by_id(config.dataset_id);
      
      // Check if this config is already using a synthetic dataset
      let synthetic_dataset_id: number;
      let isAlreadySynthetic = false;
      
      if (dataset) {
        // Check if the dataset name contains the dependency pattern (indicating it's synthetic)
        const depValues = Object.values(deps);
        isAlreadySynthetic = depValues.every(depValue => dataset.name.includes(`__${depValue}`));
      }
      
      if (isAlreadySynthetic) {
        // Already using a synthetic dataset, reuse it
        synthetic_dataset_id = dataset.id;
      } else {
        // Either no dataset or using original dataset, get/create synthetic dataset
        const originalDataset = dataset;
        synthetic_dataset_id = await get_or_create_synthetic_dataset(
            originalDataset?.name || 'synth',
            Object.values(deps)
        );
        
        // Update the config to use the synthetic dataset
        await update_promptconfig_dataset(config.id, synthetic_dataset_id);
        
        // If we had an original dataset, generate combinations from it
        if (originalDataset) {
          const inputIds = await get_all_input_ids_from_dataset(originalDataset.id);
          for (const input_id of inputIds) {
            const baseInput = await get_input_by_id(input_id);
            const baseMarkers = await get_marker_map(baseInput);

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

            // Save combinations (duplicates will be handled by save_combination_as_input)
            for (const combo of combinations) {
              const fullMarkers = { ...combo, ...baseMarkers };
              await save_combination_as_input(synthetic_dataset_id, config.id, fullMarkers);
            }
          }
        } else {
          // No original dataset, create combinations from dependencies only
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

          // Save combinations (duplicates will be handled by save_combination_as_input)
          for (const combo of combinations) {
            await save_combination_as_input(synthetic_dataset_id, config.id, combo);
          }
        }
      }
      
      // Always check for new combinations from updated dependencies
      if (isAlreadySynthetic) {
        // For existing synthetic datasets, check if there are new dependency results to add
        let newCombinations: PromptVarsDict[] = [{}];
        for (const [varName, template_id] of Object.entries(deps)) {
          const results = await get_results_by_template(template_id);
          const newCombs: PromptVarsDict[] = [];
          for (const combo of newCombinations) {
            for (const result of results) {
              newCombs.push({ ...combo, [varName]: result.output_result });
            }
          }
          newCombinations = newCombs;
        }

        // Add any new combinations (save_combination_as_input handles duplicates)
        for (const combo of newCombinations) {
          await save_combination_as_input(synthetic_dataset_id, config.id, combo);
        }
      }
      
      await run_configs(experiment, [config]);
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
      if (!config.dataset_id) {
        continue;
      }
      const dataset = await get_dataset_by_id(config.dataset_id);
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
  }
}
