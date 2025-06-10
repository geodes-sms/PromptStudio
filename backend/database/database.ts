// @ts-ignore
import mysql from "mysql2/promise";
import {readFile} from "fs/promises";
import {
  Dataset,
  Evaluator,
  Experiment,
  Input,
  Llm,
  Llm_params,
  MarkerValue,
  Promptconfig,
  prompttemplate, Result
} from "../api/types";
import {LLMSpec} from "../typing";

// @ts-ignore
import fs from "fs";
import {parse} from "csv-parse";

export const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "promptstudio",
  waitForConnections: true,
});

export async function save_dataset(file: string, name: string, template_id: number): Promise<number> {
  try {
    const sql_dataset = 'INSERT INTO Dataset(name) VALUES (?)';
    const sql_input = 'INSERT INTO data_input(dataset_id) VALUES (?)';
    const sql_input_marker = 'INSERT INTO input_marker(input_id, marker_values_id) VALUES (?, ?)';
    const sql_marker = 'INSERT INTO marker(marker, template_id) VALUES (?, ?)';
    const sql_marker_value = 'INSERT INTO marker_value(marker_id, value) VALUES (?, ?)';
    const sql_oracle = 'UPDATE data_input SET oracle = ? WHERE id = ?';

    const [result] = await pool.execute(sql_dataset, [name]);
    const dataset_id = (result as any).insertId;

    const markers_id: Record<string, number> = {};

    const parser = fs.createReadStream(file).pipe(parse({ columns: true, trim: true }));

    for await (const row of parser) {
      const [resInput] = await pool.execute(sql_input, [dataset_id]);
      const input_id = (resInput as any).insertId;

      for (const marker of Object.keys(row)) {
        if (marker === 'oracle'){
          await pool.execute(sql_oracle, [row[marker], input_id]);
          continue;
        }
        if (!(marker in markers_id)) {
          const [resMarker] = await pool.execute(sql_marker, [marker, template_id]);
          markers_id[marker] = (resMarker as any).insertId;
        }

        const [resMarkerVal] = await pool.execute(sql_marker_value, [markers_id[marker], row[marker]]);
        const marker_value_id = (resMarkerVal as any).insertId;

        await pool.execute(sql_input_marker, [input_id, marker_value_id]);
      }
    }

    console.log('CSV file successfully processed');
    return dataset_id;

  } catch (error) {
    console.error('Error in save_dataset:', error);
  }
}

export async function save_template(template: string, name: string): Promise<number> {
  try {
    const sql = "INSERT INTO PromptTemplate(value, name) VALUES (?, ?)";
    const values = [template, name];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  } catch (error) {
    console.error(error);
  }
}

export async function save_experiment(experiment: Experiment): Promise<number> {
  try {
    const sql = "INSERT INTO Experiment(title, iterations, max_retry, threads) VALUES (?, ?, ?, ?)";
    const values = [experiment.title, experiment.iterations, experiment.max_retry, experiment.threads];
    const [result] = await pool.execute(sql, values);
    return result.insertId;
  } catch (error) {
    console.error(error);
  }
}

export async function save_llm(llm: LLMSpec): Promise<number>{
  try{
    const sql = "INSERT INTO LLM(base_model, name, model) VALUES (?, ?, ?)";
    const values = [llm.base_model, llm.name, llm.model];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error(error);
    }
}

export async function save_llm_param(llm_params: Partial<Llm_params>): Promise<number>{
  try{
    const fields = [];
    const values = [];
    const placeholders = [];

    if (llm_params.temperature !== undefined) {
      fields.push('temperature');
      values.push(llm_params.temperature);
      placeholders.push('?');
    }
    if (llm_params.max_tokens !== undefined) {
      fields.push('max_tokens');
      values.push(llm_params.max_tokens);
      placeholders.push('?');
    }
    if (llm_params.top_p !== undefined) {
      fields.push('top_p');
      values.push(llm_params.top_p);
      placeholders.push('?');
    }
    if (llm_params.top_k !== undefined) {
      fields.push('top_k');
      values.push(llm_params.top_k);
      placeholders.push('?');
    }
    if (llm_params.stop_sequence !== undefined) {
      fields.push('stop_sequence');
      values.push(llm_params.stop_sequence);
      placeholders.push('?');
    }
    if (llm_params.frequency_penalty !== undefined) {
      fields.push('frequency_penalty');
      values.push(llm_params.frequency_penalty);
      placeholders.push('?');
    }
    if (llm_params.presence_penalty !== undefined) {
      fields.push('presence_penalty');
      values.push(llm_params.presence_penalty);
      placeholders.push('?');
    }

    if (fields.length === 0) {
      throw new Error('No valid parameters provided');
    }

    const sql = `INSERT INTO llm_param(${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const [result] = await pool.execute(sql, values);
    const llm_param_id = (result as any).insertId;

    // Save custom parameters if provided
    if (llm_params.custom_params) {
      const customParamSql = 'INSERT INTO llm_custom_param(name, value, llm_param_id) VALUES (?, ?, ?)';
      for (const [name, value] of Object.entries(llm_params.custom_params)) {
        await pool.execute(customParamSql, [name, value, llm_param_id]);
      }
    }

    return llm_param_id;
    }
    catch (error) {
        console.error(error);
    }
}

export async function save_promptconfig(experiment_id: number, llm_id: number, llm_param_id: number, template_id: number, dataset_id: number): Promise<number>{
  try{
    const sql = 'INSERT INTO promptconfig(experiment_id, llm_id, llm_param_id, prompt_template_id, dataset_id) VALUES (?, ?, ?, ?, ?)';
    const values = [experiment_id, llm_id, llm_param_id, template_id, dataset_id];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error(error);
    }
}

export async function get_prompt_config_by_experiment(experiment_id: number): Promise<Promptconfig[]> {
  try {
    const sql = 'SELECT * FROM promptconfig WHERE experiment_id = ?';
    const [rows] = await pool.execute(sql, [experiment_id]);
    return rows as Promptconfig[];
  }
    catch (error) {
        console.error(error);
        return [];
    }
}

export async function get_experiment_by_name(experiment_name: string): Promise<Experiment>{
  try{
    const sql = 'SELECT * FROM experiment WHERE title = ?';
    const [rows] = await pool.execute(sql, [experiment_name]);
    if ((rows as any[]).length > 0) {
      return (rows as Experiment[])[0];
    }
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_llm_by_id(llm_id: number): Promise<Llm>{
  try{
    const sql = 'SELECT * FROM llm WHERE id = ?';
    const [rows] = await pool.execute(sql, [llm_id]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0];
    }
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_llm_param_by_id(llm_param_id: number): Promise<Llm_params>{
  try{
    const sql = 'SELECT * FROM llm_param WHERE id = ?';
    const [rows] = await pool.execute(sql, [llm_param_id]);
    if ((rows as any[]).length > 0) {
      const llm_param = (rows as any[])[0];

      const customParamSql = 'SELECT name, value FROM llm_custom_param WHERE llm_param_id = ?';
      const [customRows] = await pool.execute(customParamSql, [llm_param_id]);
      
      const custom_params: Record<string, string> = {};
      for (const row of customRows as any[]) {
        custom_params[row.name] = row.value;
      }
      
      return {
        ...llm_param,
        custom_params: Object.keys(custom_params).length > 0 ? custom_params : undefined
      };
    }
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_template_by_name(name: string): Promise<prompttemplate>{
    try{
        const sql = 'SELECT * FROM PromptTemplate WHERE name = ?';
        const [rows] = await pool.execute(sql, [name]);
        if ((rows as any[]).length > 0) {
        return (rows as prompttemplate[])[0];
        }
        return undefined;
    }
    catch (error) {
      console.error(error);
    }
}

export async function get_template_by_id(template_id: number): Promise<prompttemplate> {
  try {
    const sql = 'SELECT * FROM PromptTemplate WHERE id = ?';
    const [rows] = await pool.execute(sql, [template_id]);
    if ((rows as any[]).length > 0) {
      return (rows as prompttemplate[])[0];
    }
    return undefined;
  } catch (error) {
    console.error(error);
  }
}

export async function get_dataset_by_id(dataset_id:  number): Promise<Dataset>{
  try{
    const sql = 'SELECT * FROM Dataset WHERE id = ?';
    const [rows] = await pool.execute(sql, [dataset_id]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0];
    }
    return undefined;
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_dataset_by_name(name: string): Promise<Dataset>{
  try{
    const sql = 'SELECT * FROM Dataset WHERE name = ?';
    const [rows] = await pool.execute(sql, [name]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0];
    }
    return undefined;
  }
  catch (error) {
    console.error(error);
  }
}

async function fetch_input_with_markers(input_id: number): Promise<Input> {
  const sqlMarkers = 'SELECT marker_values_id FROM input_marker WHERE input_id = ?';
  const [rowsMarkers] = await pool.execute(sqlMarkers, [input_id]);
  const markerValueIds: number[] = (rowsMarkers as any[]).map(row => row.marker_values_id);

  if (markerValueIds.length === 0) {
    return { id: input_id, markers: [] };
  }

  const placeholders = markerValueIds.map(() => '?').join(',');
  const sqlValues = `SELECT id, marker_id, value
                     FROM marker_value
                     WHERE id IN (${placeholders})`;
  const [rowsValues] = await pool.execute(sqlValues, markerValueIds);

  const markers: MarkerValue[] = (rowsValues as any[]).map(row => ({
    id: row.id,
    marker_id: row.marker_id,
    value: row.value
  }));

  return { id: input_id, markers };
}

export async function get_input_by_id(input_id: number): Promise<Input | undefined> {
  try {
    const sqlCheck = 'SELECT id FROM data_input WHERE id = ?';
    const [rowsInput] = await pool.execute(sqlCheck, [input_id]);

    if ((rowsInput as any[]).length === 0) {
      return undefined;
    }

    return await fetch_input_with_markers(input_id);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}


export async function get_next_input(dataset_id: number, last_input_id = 0): Promise<Input | undefined> {
  try {
    const sqlNext = `SELECT id FROM data_input WHERE dataset_id = ? AND id > ? ORDER BY id LIMIT 1`;
    const [rowsNext] = await pool.execute(sqlNext, [dataset_id, last_input_id]);

    if ((rowsNext as any[]).length === 0) {
      return undefined;
    }

    const newInputId: number = (rowsNext as any[])[0].id;
    return await fetch_input_with_markers(newInputId);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

export async function get_marker_by_id(marker_id: number): Promise<string>{
  try{
    const sql = 'SELECT marker FROM marker WHERE id = ?';
    const [rows] = await pool.execute(sql, [marker_id]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0].marker;
    }
  }
  catch (error) {
    console.error(error);
  }
}

export async function save_response(config_id: number, output_result: string, input_id: number, start_time: string, end_time: string, total_tokens: number){
  const sql = 'INSERT INTO result(config_id, output_result, input_id, start_time, end_time, total_tokens) VALUES (?, ?, ?, ?, ?, ?)';
  const values = [config_id, output_result, input_id, start_time, end_time, total_tokens];
  try{
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_last_input_id(dataset_id: number): Promise<number>{
  try{
    const sql = 'SELECT MAX(id) as id FROM data_input WHERE dataset_id = ?';
    const [rows] = await pool.execute(sql, [dataset_id]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0].id;
    }
  }
  catch (error) {
    console.error(error);
  }
}

export async function save_error(config_id: number, error_message: string, error_status: number, input_id: number, start_time: Date, end_time: Date): Promise<number>{
  try{
    const sql = 'INSERT INTO error(config_id, error_message, error_code, input_id, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)';
    const values = [config_id, error_message, error_status, input_id, start_time, end_time];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_results(config_id: number, input_id: number): Promise<Result[]>{
  try {
    const sql = 'SELECT output_result FROM result WHERE config_id = ? AND input_id = ?';
    const [rows] = await pool.execute(sql, [config_id, input_id]);
    return rows as Result[];
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_llm_by_base_model(base_model: string): Promise<Llm> {
  try {
    const sql = 'SELECT * FROM llm WHERE base_model = ?';
    const [rows] = await pool.execute(sql, [base_model]);
    return (rows as Llm[])[0];
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_dataset_size(dataset_id: number): Promise<number>{
    try {
        const sql = 'SELECT COUNT(*) as size FROM data_input WHERE dataset_id = ?';
        const [rows] = await pool.execute(sql, [dataset_id]);
        return (rows as any[])[0].size;
    } catch (error) {
        console.error(error);
        return 0;
    }
}

export async function save_evaluator(evaluator: Evaluator): Promise<number>{
  try{
    const sql = 'INSERT INTO Evaluator(type, code, name) VALUES (?, ?, ?)';
    const [result] = await pool.execute(sql, [evaluator.type, evaluator.code, evaluator.name]);
    return (result as any).insertId;
  }
  catch (error) {
    console.error(error);
  }
}

export async function save_evaluator_config(evaluator_id: number, config_id: number) {
  try {
    const sql = 'INSERT INTO Evaluator_config(evaluator_id, config_id) VALUES (?, ?)';
    const [result] = await pool.execute(sql, [evaluator_id, config_id]);
    return (result as any).insertId;
  } catch (error) {
    console.error(error);
  }
}

export async function get_evaluator_by_name(name: string): Promise<Evaluator>{
  try{
    const sql = 'SELECT * FROM Evaluator WHERE name = ?';
    const [rows] = await pool.execute(sql, [name]);
    if ((rows as any[]).length > 0) {
      return (rows as Evaluator[])[0];
    }
    return undefined;
  }
  catch (error) {
    console.error(error);
  }
}

export async function get_results_by_config(config_id: number): Promise<Result[]> {
  try {
    const sql = 'SELECT * FROM result WHERE config_id = ?';
    const [rows] = await pool.execute(sql, [config_id]);
    return rows as Result[];
  } catch (error) {
    console.error(error);
    return [];
  }
}

export async function get_evaluators_by_config(config_id: number): Promise<Evaluator[]>{
    try {
        const sql = 'SELECT e.* FROM Evaluator e JOIN Evaluator_config ec ON e.id = ec.evaluator_id WHERE ec.config_id = ?';
        const [rows] = await pool.execute(sql, [config_id]);
        return rows as Evaluator[];
    } catch (error) {
        console.error(error);
        return [];
    }
}