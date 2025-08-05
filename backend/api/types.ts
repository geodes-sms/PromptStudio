import {LLMSpec} from "../typing";

export type Experiment = {
  id: number;
  title: string;
  max_retry?: number;
  threads?: number;
};

export type Promptconfig = {
  id: number;
  experiment_id: number;
  LLM_id: number;
  LLM_param_id: number;
  prompt_template_id: number;
  final_dataset_id: number;
  datasets: number[];
};

export enum Eval_type {
  simple,
  javascript,
  python,
}

export type Evaluator = {
  node_id: number;
  type: Eval_type;
  file?: string;
  code?: string;
  name: string;
  return_type: Return_type;
};

enum Return_type{
  string = "string",
  number = "number",
  boolean = "boolean",
}

export type MarkerValue = {
  id: number;
  marker_id: number;
  value: string;
}

export type Input = {
  id: number;
  markers: MarkerValue[];
}

export type prompttemplate = {
  node_id : number;
  value: string;
  name: string;
  iterations: number;
  llms: LLMSpec[];
}

export type Llm = {
  id: number;
  base_model: string;
  name: string;
  model: string;
}

export type Llm_params = {
  id: number;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  stop_sequence?: string;
  frequency_penalty?: number;
  presence_penalty?: number;
  custom_params?: Record<string, string>;
}

export type Dataset = {
  node_id: number;
  name: string;
  path: string;
}

export type Result = {
  id: number;
  config_id: number;
  output_result: string;
  input_id: number;
  start_time: Date;
  end_time: Date;
}

export enum NodeType{
  'prompt_template'= 'prompt_template',
  'processor'= 'processor',
  'evaluator'= 'evaluator',
  'dataset'= 'dataset',
}

export type Experiment_node = {
  id: number;
  type: NodeType;
  experiment_id: number;
  name: string;
}

export type Link = {
  source_node_id: number;
  target_node_id: number;
  source_var: string | null;
  target_var: string | null;
}

export type ProcessorResult = {
  processor_result: string;
  result_id?: number;
  processor_id: number;
  input_id?: number;
}

export type ExperimentProcessor = {
  node_id: number;
  type: Eval_type;
  code: string;
  name: string;
}

export type Db_credentials = {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
}