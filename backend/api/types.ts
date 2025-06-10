import Dict = NodeJS.Dict;
import {JSONCompatible} from "../typing";

export type MarkerMap = Record<string, string[]>;

export type Experiment = {
  id: number;
  title: string;
  iterations: number;
  max_retry?: number;
  threads?: number;
};

export type Promptconfig = {
  id: number;
  experiment_id: number;
  LLM_id: number;
  LLM_param_id: number;
  prompt_template_id: number;
  dataset_id: number;
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
};

export type Marker = {
  id: number;
  marker: string;
  template_id: number;
};

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

export type Data_input = {
  id: number;
  dataset_id: number;
  oracle?: string;
}