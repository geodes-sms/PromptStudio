import * as fs from "fs";
import { readFile } from "fs/promises";
import * as yaml from "js-yaml";
// @ts-ignore
import ProgressBar from "progress";

import {
  Evaluator,
  Llm_params,
  Promptconfig,
  Input,
  Result,
} from "../backend/api/types";
import {
  executejs,
  queryLLM,
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
  get_marker_by_id,
  save_response,
  get_last_input_id,
  save_error,
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
} from "./apiCall";
import { PromptPermutationGenerator } from "../backend/template";
import {getTokenCount} from "./token";

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

      let existingTemplate = await get_template_by_name(templateName);
      while (existingTemplate) {
        templateName = `${config.template.name}_${templateCounter++}`;
        existingTemplate = await get_template_by_name(templateName);
      }

      const template_id = await save_template(template, templateName);
      const dataset = config.dataset;
      const existingDataset = await get_dataset_by_name(dataset.name);

      const dataset_id = existingDataset
          ? existingDataset.id
          : await save_dataset(dataset.path, dataset.name, template_id);

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
    total_inputs += await get_dataset_size(config.dataset_id);
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
          console.log(eval_result);
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}

async function get_marker_map(input: Input) {
  const markersDict: PromptVarsDict = {};
  for (const marker of input.markers) {
    const name = await get_marker_by_id(marker.marker_id);
    markersDict[name] = marker.value;
  }
  return markersDict;
}

function create_llm_spec(llm: LLMSpec, llm_param: Llm_params): LLMSpec {
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

export async function run_experiment(experiment_name: string) {
  try {
    const experiment = await get_experiment_by_name(experiment_name);
    const prompt_configs = await get_prompt_config_by_experiment(experiment.id);
    const total = await get_number_of_total_inputs(prompt_configs);

    const bar = new ProgressBar("Processing LLM calls: [:bar] :percent :etas", { total });
    let errors = 0;

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

        let tries = 0;

        while (tries <= experiment.max_retry) {
          const responses = await queryLLM(
              config.id.toString(),
              [llm_spec],
              iterations,
              template.value,
              markersDict,
              [undefined],
              {
                OpenAI: "sk-bmbbiv6x1vjlub79148bha2hnz2m2of",
                Google: "AIzaSyCUCsxmHNL8GlBzeDhERyUgMXzYzwgxHJk",
              }
          );

          for (const response of responses.responses) {
            // console.log(response.tokens);
            bar.tick();
            for (const llm_response of response.responses) {
              await save_response(config.id, llm_response, input_id);
            }
          }

          if (!responses.errors || Object.keys(responses.errors).length === 0) break;

          for (const key of Object.keys(responses.errors)) {
            for (const err of responses.errors[key]) {
              // TODO Change save_error to add status code and message
              await save_error(config.id, err.message, err.status, input_id);
              tries++;
              if (tries >= experiment.max_retry) {
                errors++;
                bar.tick();
              }
            }
          }
        }
      }
    }
    if (errors > 0) {
      console.error(`Experiment "${experiment_name}" completed with ${errors} errors.`);
    }
    else {
      console.log(`Experiment "${experiment_name}" completed successfully.`);
    }
  } catch (error) {
    console.error(error);
  }
}

export async function getTotalTokenCountForExperiment(experimentName: string): Promise<number> {
  try {
    const experiment = await get_experiment_by_name(experimentName);
    const prompt_configs: Promptconfig[] = await get_prompt_config_by_experiment(experiment.id);
    let totalTokens = 0;

    for (const config of prompt_configs) {
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
