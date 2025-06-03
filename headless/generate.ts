import * as fs from "fs";
import * as yaml from "js-yaml";
import {Evaluator, Llm_params, Promptconfig, Input, Result} from "../backend/api/types";
// @ts-ignore
import ProgressBar from 'progress';
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
  get_evaluators_by_config, get_input_by_id,
} from "./apiCall";
import {executejs, queryLLM} from "../backend/backend";
import {LLMResponse, LLMSpec, PromptVarsDict} from "../backend/typing";
import {Command} from "commander";
import {readFile} from "fs/promises";
import {PromptPermutationGenerator} from "../backend/template";

async function save_config(yml_file: string){
  try{
    const file = fs.readFileSync(yml_file, "utf8");
    const parsed: any = yaml.load(file);
    
    // Check if experiment name already exists and find a unique name
    let experimentName = parsed.experiment.title;
    let counter = 1;
    let existingExperiment = await get_experiment_by_name(experimentName);
    
    while (existingExperiment) {
      experimentName = `${parsed.experiment.title}_${counter}`;
      existingExperiment = await get_experiment_by_name(experimentName);
      counter++;
    }
    
    // Update the experiment object with the unique name
    const experimentToSave = {
      ...parsed.experiment,
      title: experimentName
    };
    
    const experiment_id = await save_experiment(experimentToSave);
    
    for (const config of parsed.configs){
      const template: string = config.template.value;
      let templateName = config.template.name;
      let evaluators_id: number[] = [];
      for (const evaluator of config.evaluators as Evaluator[]){
        // Check if evaluator already exists
        const existingEvaluator = await get_evaluator_by_name(evaluator.name);
        if (existingEvaluator){
          evaluators_id.push(existingEvaluator.id);
        }
        else{
          evaluator.code = await readFile(evaluator.file, 'utf8');
          const evaluator_id = await save_evaluator(evaluator);
          evaluators_id.push(evaluator_id);
        }
      }
      
      // Check if template name already exists and find a unique name
      let templateCounter = 1;
      let existingTemplate = await get_template_by_name(templateName);
      
      while (existingTemplate) {
        templateName = `${config.template.name}_${templateCounter}`;
        existingTemplate = await get_template_by_name(templateName);
        templateCounter++;
      }
      
      const template_id = await save_template(template, templateName);
      const dataset = config.dataset;
      const existingDataset = await get_dataset_by_name(dataset.name);
      let dataset_id: number;
      if (existingDataset) {
        // If dataset already exists, use its ID
        dataset_id = existingDataset.id;
      }
      else {
        // Otherwise, save the new dataset
        dataset_id = await save_dataset(dataset.path, dataset.name, template_id);
      }
      for (const llm of config.llms as LLMSpec[]){
        // Check if LLM already exists
        const existingLLM = await get_llm_by_base_model(llm.base_model);
        let llm_id: number;
        if (existingLLM) {
          // If LLM already exists, use its ID
          llm_id = existingLLM.id;
        } else {
          // Otherwise, save the new LLM
          llm_id = await save_llm(llm);
        }

        
        // Extract LLM parameters from LLMSpec and map to Llm_params structure
        const llm_params: Partial<Llm_params> = {};
        const custom_params: Record<string, string> = {};

        if (llm.temp !== undefined) llm_params.temperature = llm.temp;

        const nativeLLMSpecProps = ['name', 'model', 'temp', 'base_model', 'settings', 'emoji', 'key'];
        const knownparams = ['max_tokens', 'top_p', 'top_k', 'stop_sequence', 'frequency_penalty', 'presence_penalty'];
        for (const [key, value] of Object.entries(llm)) {
          if (knownparams.includes(key)) {
            llm_params[key] = value;
            continue;
          }
          if (!nativeLLMSpecProps.includes(key) && value !== undefined) {
            custom_params[key] = String(value);
          }
        }
        
        // Add custom_params to llm_params if any exist
        if (Object.keys(custom_params).length > 0) {
          llm_params.custom_params = custom_params;
        }
        
        const llm_param_id = await save_llm_param(llm_params);
        const config_id = await save_promptconfig(experiment_id, llm_id, llm_param_id, template_id, dataset_id);
        for (const evaluator_id of evaluators_id){
          await save_evaluator_config(evaluator_id, config_id);
        }
      }
    }
    return experimentName;
  }
    catch (error) {
        console.error(error);
    }
}

async function get_number_of_total_inputs(prompt_configs: Promptconfig[]): Promise<number> {
  let total_inputs = 0;
  for (const config of prompt_configs){
    const dataset_size = await get_dataset_size(config.dataset_id);
    total_inputs += dataset_size;
  }
  return total_inputs;
}

async function evaluate_experiment(experiment_name: string){
  try{
    const experiment = await get_experiment_by_name(experiment_name);
    const prompt_configs = await get_prompt_config_by_experiment(experiment.id);
    for (const config of prompt_configs){
      const results: Result[] = await get_results_by_config(config.id);
      const evaluators: Evaluator[] = await get_evaluators_by_config(config.id);
      const llm: LLMSpec = await get_llm_by_id(config.LLM_id);
      const llm_param: Llm_params = await get_llm_param_by_id(config.LLM_param_id);
      const llm_spec = create_llm_spec(llm, llm_param);
      if (results && results.length > 0){
        for (const result of results){
          const input: Input = await get_input_by_id(result.input_id);
          const markersDict = await get_marker_map(input);
          const prompt_template = await get_template_by_id(config.prompt_template_id);
          const gen = new PromptPermutationGenerator(prompt_template.value);
          const prompt = gen.generate(markersDict).next().value.toString();
          for (const evaluator of evaluators){
            const response: LLMResponse = {
              responses: [result.output_result],
              prompt: prompt,
              vars: markersDict,
              metavars: {},
              llm: llm_spec,
              uid: ""
            }
            const eval_result = await executejs('0', evaluator.code, [response], 'response', 'evaluator');
            console.log(eval_result);
          }
        }
      }
    }
  }
  catch (error) {
    console.error(error);
  }
}

async function get_marker_map(input: Input){
  let markersDict: PromptVarsDict = {};
  for (const marker of input.markers){
    const marker_name: string = await get_marker_by_id(marker.marker_id);
    markersDict[marker_name] = marker.value;
  }
  return markersDict;
}

function create_llm_spec(llm: LLMSpec, llm_param: Llm_params){
  // Build settings object with all non-native LLMSpec parameters
  const settings: any = {};

  // Add standard LLM parameters to settings if they exist
  if (llm_param.max_tokens !== undefined) settings.max_tokens = llm_param.max_tokens;
  if (llm_param.top_p !== undefined) settings.top_p = llm_param.top_p;
  if (llm_param.top_k !== undefined) settings.top_k = llm_param.top_k;
  if (llm_param.stop_sequence !== undefined) settings.stop_sequence = llm_param.stop_sequence;
  if (llm_param.frequency_penalty !== undefined) settings.frequency_penalty = llm_param.frequency_penalty;
  if (llm_param.presence_penalty !== undefined) settings.presence_penalty = llm_param.presence_penalty;

  // Add custom parameters to settings if they exist
  if (llm_param.custom_params) {
    Object.assign(settings, llm_param.custom_params);
  }

  const llm_spec: LLMSpec = {
    name: llm.name,
    model: llm.model,
    temp: llm_param.temperature,
    base_model: llm.base_model,
    settings: settings,
  }
    return llm_spec;
}

async function run_experiment(experiment_name: string) {
  try{
    const experiment = await get_experiment_by_name(experiment_name);
    const prompt_configs = await get_prompt_config_by_experiment(experiment.id);
    const number_of_total_inputs = await get_number_of_total_inputs(prompt_configs);
    const bar = new ProgressBar('Processing: [:bar] :percent :etas', {
      total: number_of_total_inputs,
    });
    let progress = 0;
    let errors = 0;
    for (const config of prompt_configs){
      const llm = await get_llm_by_id(config.LLM_id);
      const llm_param = await get_llm_param_by_id(config.LLM_param_id);
      const template = await get_template_by_id(config.prompt_template_id);
      const dataset = await get_dataset_by_id(config.dataset_id);
      let input_id = 0;
      const last_id = await get_last_input_id(dataset.id);
      while(true){
        if (input_id === last_id){
          break;
        }
        const input = await get_next_input(dataset.id, input_id);
        if (input === undefined){
            break;
        }
        input_id = input.id;
        const markersDict = await get_marker_map(input);

        const llm_spec = create_llm_spec(llm, llm_param);

        const results = await get_results(config.id, input_id);
        let iterations = experiment.iterations;

        if (results && results.length > 0) {
          iterations -= results.length;
        }
        if (iterations <= 0){
          continue;
        }
        let tries = 0;
        while(tries < experiment.max_retry + 1){
          const responses = await queryLLM(
              config.id.toString(),
              [llm_spec],
              iterations,
              template.value,
              markersDict,
              [undefined],
              {
                OpenAI: "sk-bmbbiv6x1vjlub79148bha2hnz2m2of",
                Google: "AIzaSyCUCsxmHNL8GlBzeDhERyUgMXzYzwgxHJk"
              }
          );
          for (const response of responses.responses){
            bar.tick();
            progress++;
            for (const llm_response of response.responses){
              await save_response(config.id, llm_response, input_id);
            }
          }
          if (responses.errors === undefined || Object.keys(responses.errors).length === 0){
            break; // Exit the retry loop if there are no errors
          }
          for (const keys of Object.keys(responses.errors)){
            for (const error of responses.errors[keys]) {
              await save_error(config.id, error, input_id);
              tries++;
              if (tries === experiment.max_retry){
                errors++;
                bar.tick();
              }
            }
          }
        }
      }
    }
  }
  catch (error) {
    console.error(error);
  }
}

const program = new Command();
program
    .name('headless')
    .option('-c, --config <string>', 'Path to the YAML configuration file')
    .option('-n, --name <string>', 'Name of the experiment')
    .action((options) => {
      if (options.name && options.config){
        console.error("Please provide either a configuration file or an experiment name, not both.");
        process.exit(1);
      }
    })
    .parse(process.argv);

const options = program.opts();

if(options.config){
  const experiment_name = save_config(options.config);
    experiment_name.then(name => {
        run_experiment(name).then(()=>{
          evaluate_experiment(name);
        })
    });
}
else if(options.name){
  run_experiment(options.name);
}
else {
  console.error("Please provide a configuration file or an experiment name.");
}