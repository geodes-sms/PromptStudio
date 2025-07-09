// @ts-ignore
import mysql from "mysql2/promise";
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
import {LLMSpec, PromptVarsDict} from "../typing";

// @ts-ignore
import fs from "fs";
import {parse} from "csv-parse";

import crypto from "crypto";

export const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "promptstudio",
  waitForConnections: true,
});

/**
 * Saves a dataset to the database.
 * This function processes a CSV file, extracts markers and their values,
 * inserts them into the database, and associates them with the dataset and the template.
 * @param file The path to the CSV file containing the dataset.
 * @param name The name of the dataset to be saved.
 * @param template_id The ID of the template associated with the dataset.
 * @return The ID of the newly created dataset.
 */
export async function save_dataset(file: string, name: string, template_id: number): Promise<number> {
  try {
    const sql_dataset = 'INSERT INTO Dataset(name) VALUES (?)';
    const [result] = await pool.execute(sql_dataset, [name]);
    const dataset_id = (result as any).insertId;

    // If no file is provided, return the dataset_id immediately meaning it's a synthetic dataset and will be filled later.
    if (!file || file.trim() === '') {
      return dataset_id;
    }

    const sql_input = 'INSERT INTO data_input(dataset_id) VALUES (?)';
    const sql_input_marker = 'INSERT INTO input_marker(input_id, marker_values_id) VALUES (?, ?)';
    const sql_marker = 'INSERT INTO marker(marker, template_id) VALUES (?, ?)';
    const sql_marker_value = 'INSERT INTO marker_value(marker_id, value) VALUES (?, ?)';
    const sql_oracle = 'UPDATE data_input SET oracle = ? WHERE id = ?';

    const markers_id: Record<string, number> = {};
    const parser = fs.createReadStream(file).pipe(parse({ columns: true, trim: true }));

    for await (const row of parser) {
      const [resInput] = await pool.execute(sql_input, [dataset_id]);
      const input_id = (resInput as any).insertId;

      for (const marker of Object.keys(row)) {
        if (marker === 'oracle') {
          await pool.execute(sql_oracle, [row[marker], input_id]);
          continue;
        }

        // Get or insert marker
        if (!(marker in markers_id)) {
          const [resMarker] = await pool.execute(sql_marker, [marker, template_id]);
          markers_id[marker] = (resMarker as any).insertId;
        }

        const marker_id = markers_id[marker];
        const value = row[marker];
        const hash = computeMarkerValueHash(marker_id, value);

        // Get or insert marker_value by hash
        const [valueRows] = await pool.execute(
            "SELECT id FROM marker_value WHERE marker_id = ? AND hash = ?",
            [marker_id, hash]
        );

        let marker_value_id: number;
        if ((valueRows as any[]).length === 0) {
          const [resMarkerVal] = await pool.execute(
              sql_marker_value,
              [marker_id, value]
          );
          marker_value_id = (resMarkerVal as any).insertId;
        } else {
          marker_value_id = (valueRows as any)[0].id;
        }

        await pool.execute(sql_input_marker, [input_id, marker_value_id]);
      }
    }

    return dataset_id;

  } catch (error) {
    console.error('Error in save_dataset:', error);
  }
}

/**
 * Saves a prompt template to the database.
 * This function inserts a template into the PromptTemplate table and associates any sub-templates with it.
 * @param template The prompt template string to be saved.
 * @param name The name of the template.
 * @param vars An optional record of variable names and their corresponding sub-template IDs.
 * @return The ID of the newly created template.
 */
export async function save_template(template: string, name: string, vars: Record<string, string> = {}): Promise<number> {
  try {
    const sql = "INSERT INTO PromptTemplate(value, name) VALUES (?, ?)";
    const values = [template, name];
    const [result] = await pool.execute(sql, values);
    const template_id = (result as any).insertId;
    const sql_var_id = "SELECT id FROM PromptTemplate WHERE name = ?";
    for (const [var_name, var_value] of Object.entries(vars)) {
        const [rows] = await pool.execute(sql_var_id, [var_value]);
        if ((rows as any[]).length > 0) {
            const sub_template_id = (rows as any[])[0].id;
            await save_sub_template(template_id, sub_template_id, var_name);
        }
    }
    return (result as any).insertId;
  } catch (error) {
    console.error(error);
  }
}

/**
 * Saves an experiment to the database.
 * This function inserts an experiment into the Experiment table.
 * @param experiment The Experiment object containing details of the experiment.
 * @returns The ID of the newly created experiment.
 */
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

/**
 * Saves a new LLM specification to the database.
 * @param llm The LLMSpec object containing details of the LLM.
 * @returns The ID of the newly created LLM.
 */
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

/**
 * Saves LLM parameters to the database.
 * This function inserts the parameters into the llm_param table and saves any custom parameters in llm_custom_param.
 * @param llm_params The Llm_params object containing the parameters to be saved.
 * @returns The ID of the newly created LLM parameters.
 */
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

/**
 * Saves a prompt configuration to the database.
 * This function inserts a new prompt configuration into the promptconfig table.
 * @param experiment_id The ID of the experiment associated with this configuration.
 * @param llm_id The ID of the LLM used in this configuration.
 * @param llm_param_id The ID of the LLM parameters used in this configuration.
 * @param template_id The ID of the prompt template used in this configuration.
 * @param dataset_id The ID of the dataset used in this configuration.
 * @returns The ID of the newly created prompt configuration.
 */
export async function save_promptconfig(experiment_id: number, llm_id: number, llm_param_id: number, template_id: number, dataset_id: number): Promise<number>{
  try{
    const sql = 'INSERT INTO promptconfig(experiment_id, llm_id, llm_param_id, prompt_template_id, final_dataset_id) VALUES (?, ?, ?, ?, ?)';
    const values = [experiment_id, llm_id, llm_param_id, template_id, dataset_id];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error(error);
    }
}

/**
 * Retrieves all prompt configurations associated with a specific experiment.
 * @param experiment_id The ID of the experiment for which to retrieve prompt configurations.
 * @returns An array of Promptconfig objects associated with the specified experiment.
 */
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

/**
 * Retrieves an experiment by its name.
 * @param experiment_name The name of the experiment to retrieve.
 * @returns The Experiment object if found, otherwise undefined.
 */
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

/**
 * Retrieves an LLM specification by its ID.
 * This function fetches the LLM details from the database using the provided LLM ID.
 * @param llm_id The ID of the LLM to retrieve.
 * @return The LLMSpec object if found, otherwise undefined.
 */
export async function get_llm_by_id(llm_id: number): Promise<LLMSpec>{
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


/**
 * Retrieves LLM parameters by their ID.
 * This function fetches the LLM parameters from the database using the provided LLM parameter ID.
 * It also retrieves any custom parameters associated with the LLM parameter.
 * @param llm_param_id The ID of the LLM parameter to retrieve.
 * @return The Llm_params object if found, otherwise undefined.
 */
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

/**
 * Retrieves all LLM specifications from the database.
 * This function fetches all LLMs and their parameters, returning them as an array of LLMSpec objects.
 * @param template_id The ID of the template to filter LLMs by, if provided.
 * @returns An array of LLMSpec objects representing all LLMs in the database.
 */
async function get_subtemplate_vars(template_id: number): Promise<Record<string, string>>{
  const sql_sub_template = 'SELECT sub_template_id, var_name FROM sub_template WHERE main_template_id = ?';
  const [subRows] = await pool.execute(sql_sub_template, [template_id]);
  const vars = {};
  for (const row of subRows as any[]) {
    vars[row.var_name] = row.sub_template_id;
  }
  return vars;
}

/**
 * Retrieves a prompt template by its name.
 * @param name The name of the prompt template to retrieve.
 * @return The prompttemplate object if found, otherwise undefined.
 */
export async function get_template_by_name(name: string): Promise<prompttemplate>{
    try{
        const sql = 'SELECT * FROM PromptTemplate WHERE name = ?';
        const [rows] = await pool.execute(sql, [name]);
        // Check if there is subtemplate and add them in the vars record
        if ((rows as any[]).length > 0) {
          const template = (rows as prompttemplate[])[0];
          template.vars = await get_subtemplate_vars(template.id);
          return template;
        }
        return undefined;
    }
    catch (error) {
      console.error(error);
    }
}

/**
 * Retrieves a prompt template by its ID.
 * @param template_id The ID of the prompt template to retrieve.
 * @return The prompttemplate object if found, otherwise undefined.
 */
export async function get_template_by_id(template_id: number): Promise<prompttemplate> {
  try {
    const sql = 'SELECT * FROM PromptTemplate WHERE id = ?';
    const [rows] = await pool.execute(sql, [template_id]);
    // Check if there is subtemplate and add them in the vars record
    if ((rows as any[]).length > 0) {
      const template = (rows as prompttemplate[])[0];
      template.vars = await get_subtemplate_vars(template.id);
      return template;
    }
  } catch (error) {
    console.error(error);
  }
}

/**
 * Retrieves a dataset by its ID.
 * @param dataset_id The ID of the dataset to retrieve.
 * @return The Dataset object if found, otherwise undefined.
 */
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

/**
 * Retrieves a dataset by its name.
 * @param name The name of the dataset to retrieve.
 * @return The Dataset object if found, otherwise undefined.
 */
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

/**
 * Fetches an input along with its associated markers from the database.
 * @param input_id The ID of the input to fetch.
 * @return An Input object containing the input ID and its associated markers.
 */
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

/**
 * Retrieves an input by its ID, including its associated markers.
 * @param input_id The ID of the input to retrieve.
 * @return An Input object if found, otherwise undefined.
 */
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

export async function save_error(config_id: number, error_message: string, error_status: number, input_id: number, start_time: string, end_time: string): Promise<number>{
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
    const sql = 'SELECT * FROM result WHERE config_id = ? AND input_id = ?';
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
export async function get_or_create_synthetic_dataset(
    base_name: string,
    dependency_templates: string[]
): Promise<number> {
  const synthetic_name = `${base_name}__${dependency_templates.join("__")}`;
  const [rows] = await pool.execute(
      "SELECT id FROM Dataset WHERE name = ?",
      [synthetic_name]
  );
  if ((rows as any[]).length > 0) {
    return (rows as any)[0].id;
  }

  const [result] = await pool.execute(
      "INSERT INTO Dataset (name) VALUES (?)",
      [synthetic_name]
  );
  return (result as any).insertId;
}

/**
 * Saves a synthetic input row along with its associated marker values.
 */
export async function save_combination_as_input(
    dataset_id: number,
    config_id: number,
    markers: PromptVarsDict
): Promise<number> {
  // 1. Get all input IDs for this dataset
  const [inputRows] = await pool.execute(
      "SELECT id FROM Data_Input WHERE dataset_id = ?",
      [dataset_id]
  );
  const inputIds = (inputRows as any[]).map(row => row.id);

  // 2. For each input, check if marker values match
  for (const input_id of inputIds) {
    const [markerRows] = await pool.execute(
        `SELECT m.marker, mv.value
         FROM Input_marker im
                JOIN Marker_value mv ON im.marker_values_id = mv.id
                JOIN Marker m ON mv.marker_id = m.id
         WHERE im.input_id = ?`,
        [input_id]
    );
    const dbMarkers: Record<string, string> = {};
    for (const row of markerRows as any[]) {
      dbMarkers[row.marker] = row.value;
    }

    if (
        Object.keys(dbMarkers).length === Object.keys(markers).length &&
        Object.entries(markers).every(([k, v]) => dbMarkers[k] === v)
    ) {
      return input_id;
    }
  }

  // 3. Insert new input
  const [res] = await pool.execute(
      "INSERT INTO Data_Input (dataset_id) VALUES (?)",
      [dataset_id]
  );
  const input_id = (res as any).insertId;

  const [configRows] = await pool.execute(
      "SELECT prompt_template_id FROM PromptConfig WHERE id = ?",
      [config_id]
  );
  const template_id = (configRows as any)[0].prompt_template_id;

  // 4. For each marker
  for (const [marker, value] of Object.entries(markers)) {
    // Get or insert Marker
    const [markerRows] = await pool.execute(
        "SELECT id FROM Marker WHERE marker = ? AND template_id = ?",
        [marker, template_id]
    );

    let marker_id: number;
    if ((markerRows as any[]).length === 0) {
      const [insertMarker] = await pool.execute(
          "INSERT INTO Marker (marker, template_id) VALUES (?, ?)",
          [marker, template_id]
      );
      marker_id = (insertMarker as any).insertId;
    } else {
      marker_id = (markerRows as any)[0].id;
    }

    // Compute hash
    const hash = computeMarkerValueHash(marker_id, value);

    // Get or insert Marker_value by hash
    const [valueRows] = await pool.execute(
        "SELECT id FROM Marker_value WHERE marker_id = ? AND hash = ?",
        [marker_id, hash]
    );
    let marker_value_id: number;
    if ((valueRows as any[]).length === 0) {
      const [insertValue] = await pool.execute(
          "INSERT INTO Marker_value (marker_id, value) VALUES (?, ?)",
          [marker_id, value]
      );
      marker_value_id = (insertValue as any).insertId;
    } else {
      marker_value_id = (valueRows as any)[0].id;
    }

    // Insert Input_marker link
    await pool.execute(
        "INSERT INTO Input_marker (input_id, marker_values_id) VALUES (?, ?)",
        [input_id, marker_value_id]
    );
  }

  return input_id;
}

function computeMarkerValueHash(marker_id: number, value: string): string {
  const result = crypto
      .createHash("sha256")
      .update(`${marker_id}${value}`)
      .digest("hex");
  return result;
}

export async function update_promptconfig_final_dataset(config_id: number, new_dataset_id: number) {
  await pool.execute(
      "UPDATE PromptConfig SET final_dataset_id = ? WHERE id = ?",
      [new_dataset_id, config_id]
  );
}

export async function get_all_input_ids_from_dataset(dataset_id: number): Promise<number[]> {
  const [rows] = await pool.execute(
      "SELECT id FROM Data_Input WHERE dataset_id = ? ORDER BY id ASC",
      [dataset_id]
  );
  return (rows as any[]).map(row => row.id);
}

async function save_sub_template(
    template_id: number,
    sub_template_id: number,
    var_name: string
): Promise<number> {
    try {
        const sql = 'INSERT INTO sub_template(main_template_id, sub_template_id, var_name) VALUES (?, ?, ?)';
        const values = [template_id, sub_template_id, var_name];
        const [result] = await pool.execute(sql, values);
        return (result as any).insertId;
    } catch (error) {
        console.error(error);
    }
}

export async function get_results_by_template(template_id: string): Promise<Result[]> {
  try {
    const sql = `
      SELECT r.* FROM result r
      JOIN promptconfig pc ON r.config_id = pc.id
      JOIN PromptTemplate pt ON pc.prompt_template_id = pt.id
      WHERE pt.id = ?
    `;
    const [rows] = await pool.execute(sql, [template_id]);
    return rows as Result[];
  } catch (error) {
    console.error(error);
    return [];
  }
}

export async function get_config(config_id: number): Promise<Promptconfig> {
  try {
    const sql = 'SELECT * FROM promptconfig WHERE id = ?';
    const [rows] = await pool.execute(sql, [config_id]);
    if ((rows as any[]).length > 0) {
      return (rows as Promptconfig[])[0];
    }
    return undefined;
  } catch (error) {
    console.error(error);
  }
}

export async function update_template_vars(template_id: number, vars: Record<string, string> = {}){
  try{
    const sql_var_id = "SELECT id FROM PromptTemplate WHERE name = ?";
    for (const [var_name, var_value] of Object.entries(vars)) {
      const [rows] = await pool.execute(sql_var_id, [var_value]);
      if ((rows as any[]).length > 0) {
        const sub_template_id = (rows as any[])[0].id;
        await save_sub_template(template_id, sub_template_id, var_name);
      }
    }
    return;
  }
  catch(error){
    console.error(error);
    throw error;
  }
}

export async function add_config_base_dataset(config_id: number, dataset_id: number) {
  try {
    const sql = 'INSERT INTO config_base_dataset (config_id, dataset_id) VALUES (?, ?)';
    await pool.execute(sql, [config_id, dataset_id]);
  } catch (error) {
    console.error('Error updating promptconfig with base dataset:', error);
  }
}

export async function get_base_datasets(config_id: number){
  try{
    const sql = 'SELECT dataset_id FROM config_base_dataset WHERE config_id = ?';
    const [rows] = await pool.execute(sql, [config_id]);
    return (rows as any[]).map(row => row.dataset_id);
  }
    catch (error) {
        console.error('Error fetching base datasets for config:', error);
        return [];
    }
}

export async function get_last_seen_result_id(template_id: number): Promise<number> {
  const [rows]: any = await pool.query(
      "SELECT last_seen_result_id FROM Template_dependency_progress WHERE template_id = ?",
      [template_id]
  );
  return rows.length > 0 ? rows[0].last_seen_result_id : 0;
}

export async function update_template_dependency_progress(template_id: number, result_id: number): Promise<void> {
  await pool.query(
      `INSERT INTO Template_dependency_progress(template_id, last_seen_result_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE last_seen_result_id = GREATEST(last_seen_result_id, VALUES(last_seen_result_id))`,
      [template_id, result_id]
  );
}

export async function save_eval_result(eval_result: string, result_id: number, evaluator_id: number){
  try{
    const sql = 'INSERT INTO evaluationsresult(evaluation_result, result_id, evaluator_id) VALUES (?, ?, ?)';
    const values = [eval_result, result_id, evaluator_id];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error('Error saving evaluation result:', error);
    }
}

export async function get_evaluation_result(result_id: number, evaluator_id: number): Promise<string | undefined> {
  try {
    const sql = 'SELECT evaluation_result FROM evaluationsresult WHERE result_id = ? AND evaluator_id = ?';
    const [rows] = await pool.execute(sql, [result_id, evaluator_id]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0].evaluation_result;
    }
    return undefined;
  } catch (error) {
    console.error('Error fetching evaluation result:', error);
  }
}