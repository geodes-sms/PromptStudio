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
  id: number;
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
  id : number;
  value: string;
  name: string;
  iterations: number;
  vars?: Record<string, string>;
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
  id: number;
  name: string;
}

export type Result = {
  id: number;
  config_id: number;
  output_result: string;
  input_id: number;
  start_time: Date;
  end_time: Date;
}