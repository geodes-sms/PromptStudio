import * as mysql from "mysql2/promise";
import {
  Db_credentials,
  Evaluator,
  Experiment,
  Experiment_node,
  ExperimentProcessor,
  Input,
  Link,
  Llm,
  Llm_params,
  MarkerValue,
  ProcessorResult,
  Promptconfig,
  prompttemplate,
  Result
} from "../api/types";
import {LLMSpec, PromptVarsDict} from "../typing";

import * as fs from "fs";
import {parse} from "csv-parse";

import * as crypto from "crypto";
import * as path from "node:path";

const credentialsPath = path.join(process.cwd(), "../../credentials.json");
const parsed = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));

const db_credentials: Db_credentials = parsed.database;

export const pool: mysql.Pool = mysql.createPool({
  host: db_credentials.host,
  user: db_credentials.user,
  password: db_credentials.password,
  database: db_credentials.database,
  port: db_credentials.port || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  maxIdle: 10,
  idleTimeout: 60000,
});

/**
 * Saves a dataset to the database.
 * This function processes a CSV file, extracts markers and their values,
 * inserts them into the database, and associates them with the dataset and the template.
 * @param file The path to the CSV file containing the dataset.
 * @param node_id
 * @param name The name of the dataset to be saved.
 * @param connection
 * @return The ID of the newly created dataset.
 */
export async function save_dataset(
    file: string,
    node_id: number,
    name: string,
    connection: mysql.Connection | mysql.Pool = pool
): Promise<number> {
  try {
    const sql_dataset = 'INSERT INTO Dataset(node_id, name) VALUES (?, ?)';
    await connection.execute(sql_dataset, [node_id, name]);
    const dataset_id = node_id;

    // If no file is provided, return the dataset_id immediately.
    if (!file || file.trim() === '') return dataset_id;

    const sql_input = 'INSERT INTO Data_Input(dataset_id) VALUES (?)';
    const sql_input_marker = 'INSERT INTO Input_marker(input_id, marker_values_id) VALUES (?, ?)';
    const sql_marker = 'INSERT INTO Marker(marker, dataset_id) VALUES (?, ?)';
    const sql_marker_value = 'INSERT INTO Marker_value(marker_id, value) VALUES (?, ?)';
    const sql_oracle = 'UPDATE Data_Input SET oracle = ? WHERE id = ?';

    const markers_id: Record<string, number> = {};
    const parser = fs.createReadStream(file).pipe(parse({ columns: true, trim: true }));

    for await (const row of parser) {
      const [resInput] = await connection.execute(sql_input, [dataset_id]);
      const input_id = (resInput as any).insertId;

      for (const marker of Object.keys(row)) {
        if (marker === 'oracle') {
          await connection.execute(sql_oracle, [row[marker], input_id]);
          continue;
        }

        if (!(marker in markers_id)) {
          // Insert or fetch marker — deduplication handled by unique constraint + SELECT fallback
          try {
            const [resMarker] = await connection.execute(sql_marker, [marker, dataset_id]);
            markers_id[marker] = (resMarker as any).insertId;
          } catch {
            const [rows] = await connection.execute(
                'SELECT id FROM Marker WHERE marker = ? AND dataset_id = ?',
                [marker, dataset_id]
            );
            if ((rows as any[]).length > 0) {
              markers_id[marker] = (rows as any)[0].id;
            } else {
              throw new Error(`Unable to find or create marker '${marker}' for dataset ${dataset_id}`);
            }
          }
        }

        const marker_id = markers_id[marker];
        const value = row[marker];
        const hash = computeMarkerValueHash(marker_id, value);

        const [existing] = await connection.execute(
            'SELECT id FROM Marker_value WHERE marker_id = ? AND hash = ?',
            [marker_id, hash]
        );

        let marker_value_id: number;
        if ((existing as any[]).length === 0) {
          const [resVal] = await connection.execute(sql_marker_value, [marker_id, value]);
          marker_value_id = (resVal as any).insertId;
        } else {
          marker_value_id = (existing as any)[0].id;
        }

        await connection.execute(sql_input_marker, [input_id, marker_value_id]);
      }
    }

    return dataset_id;
  } catch (error) {
    console.error('Error in save_dataset:', error);
    throw error;
  }
}

/**
 * Saves a prompt template to the database.
 * This function inserts a template into the PromptTemplate table and associates any sub-templates with it.
 * @param template The prompt template string to be saved.
 * @param name The name of the template.
 * @param iterations The number of iterations for the template.
 * @param vars An optional record of variable names and their corresponding sub-template IDs.
 * @param node_id The ID of the node associated with this template.
 * @param connection
 * @return The ID of the newly created template.
 */
export async function save_template(template: string, name: string, iterations:number, vars: Record<string, string> = {}, node_id: number, connection: mysql.Connection | mysql.Pool = pool): Promise<number> {
  try {
    const sql = "INSERT INTO PromptTemplate(node_id, value, name, iterations) VALUES (?, ?, ?, ?)";
    const values = [node_id, template, name, iterations];
    const [result] = await connection.execute(sql, values);
    return (result as any).insertId;
  } catch (error) {
    console.error(error);
  }
}

/**
 * Saves an experiment to the database.
 * This function inserts an experiment into the Experiment table.
 * @param experiment The Experiment object containing details of the experiment.
 * @param connection
 * @returns The ID of the newly created experiment.
 */
export async function save_experiment(experiment: Experiment, connection: mysql.Connection | mysql.Pool = pool): Promise<number> {
  try {
    const sql = "INSERT INTO Experiment(title, max_retry, threads) VALUES (?, ?, ?)";
    const values = [experiment.title, experiment.max_retry, experiment.threads];
    const [result] = await connection.execute(sql, values);
    return (result as any).insertId;
  } catch (error) {
    console.error(error);
  }
}

/**
 * Saves a new LLM specification to the database.
 * @param llm The LLMSpec object containing details of the LLM.
 * @param connection
 * @returns The ID of the newly created LLM.
 */
export async function save_llm(llm: LLMSpec, connection: mysql.Connection | mysql.Pool = pool): Promise<number>{
  try{
    // Check if the LLM already exists
    const existingLlm = await get_llm_by_base_model(llm.base_model, connection);
    if (existingLlm) {
      // If it exists, return its ID
      return existingLlm.id;
    }
    const sql = "INSERT INTO LLM(base_model, name, model) VALUES (?, ?, ?)";
    const values = [llm.base_model, llm.name, llm.model];
    const [result] = await connection.execute(sql, values);
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
 * @param connection
 * @returns The ID of the newly created LLM parameters.
 */
export async function save_llm_param(llm_params: Partial<Llm_params>, connection: mysql.Connection | mysql.Pool = pool): Promise<number>{
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
    const [result] = await connection.execute(sql, values);
    const llm_param_id = (result as any).insertId;

    // Save custom parameters if provided
    if (llm_params.custom_params) {
      const customParamSql = 'INSERT INTO llm_custom_param(name, value, llm_param_id) VALUES (?, ?, ?)';
      for (const [name, value] of Object.entries(llm_params.custom_params)) {
        await connection.execute(customParamSql, [name, value, llm_param_id]);
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
 * @param connection
 * @returns The ID of the newly created prompt configuration.
 */
export async function save_promptconfig(experiment_id: number, llm_id: number, llm_param_id: number, template_id: number, dataset_id: number, connection: mysql.Connection | mysql.Pool = pool): Promise<number>{
  try{
    const sql = 'INSERT INTO promptconfig(experiment_id, llm_id, llm_param_id, prompt_template_id, final_dataset_id) VALUES (?, ?, ?, ?, ?)';
    const values = [experiment_id, llm_id, llm_param_id, template_id, dataset_id];
    const [result] = await connection.execute(sql, values);
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
 * @param connection
 * @returns The Experiment object if found, otherwise undefined.
 */
export async function get_experiment_by_name(experiment_name: string, connection: mysql.Connection | mysql.Pool = pool): Promise<Experiment>{
  try{
    const sql = 'SELECT * FROM experiment WHERE title = ?';
    const [rows] = await connection.execute(sql, [experiment_name]);
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
 * Retrieves a prompt template by its ID.
 * @param template_id The ID of the prompt template to retrieve.
 * @return The prompttemplate object if found, otherwise undefined.
 */
export async function get_template_by_id(template_id: number): Promise<prompttemplate> {
  try {
    const sql = 'SELECT * FROM PromptTemplate WHERE node_id = ?';
    const [rows] = await pool.execute(sql, [template_id]);
    // Check if there is subtemplate and add them in the vars record
    if ((rows as any[]).length > 0) {
      return (rows as prompttemplate[])[0];
    }
  } catch (error) {
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

export async function get_llm_by_base_model(base_model: string, connection: mysql.Connection | mysql.Pool = pool): Promise<Llm> {
  try {
    const sql = 'SELECT * FROM llm WHERE base_model = ?';
    const [rows] = await connection.execute(sql, [base_model]);
    return (rows as Llm[])[0];
  }
  catch (error) {
    console.error(error);
  }
}

export async function save_evaluator(evaluator: Evaluator, connection: mysql.Connection | mysql.Pool = pool): Promise<number>{
  try{
    const sql = 'INSERT INTO Evaluator(node_id, type, code, name, return_type) VALUES (?, ?, ?, ?, ?)';
    const [result] = await connection.execute(sql, [evaluator.node_id, evaluator.type, evaluator.code, evaluator.name, evaluator.return_type]);
    return (result as any).insertId;
  }
  catch (error) {
    console.error(error);
  }
}

export async function save_processor(processor: Evaluator, connection: mysql.Connection | mysql.Pool = pool): Promise<number>{
  try{
    const sql = 'INSERT INTO processor(node_id, type, code, name) VALUES (?, ?, ?, ?)';
    const [result] = await connection.execute(sql, [processor.node_id, processor.type, processor.code, processor.name]);
    return (result as any).insertId;
  }
    catch (error) {
        throw error;
    }
}

function computeMarkerValueHash(marker_id: number, value: string): string {
  return crypto
      .createHash("sha256")
      .update(`${marker_id}${value}`)
      .digest("hex");
}

export async function save_sub_template(
    template_id: number,
    sub_template_id: number,
    var_name: string,
    connection: mysql.Connection | mysql.Pool = pool
): Promise<number> {
    try {
        const sql = 'INSERT INTO sub_template(main_template_id, sub_template_id, var_name) VALUES (?, ?, ?)';
        const values = [template_id, sub_template_id, var_name];
        const [result] = await connection.execute(sql, values);
        return (result as any).insertId;
    } catch (error) {
        console.error(error);
    }
}

export async function get_results_by_template(template_id: string): Promise<Result[]> {
  try {
    const sql = `
      SELECT * FROM View_Result_By_Template WHERE prompt_template_id = ?
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

export async function save_error_evaluator(evaluator_id: number, error_message: string, result_id: number, timestamp: string){
  try{
    const sql = 'INSERT INTO error_evaluator(evaluator_id, error_message, result_id, timestamp) VALUES (?, ?, ?, ?, ?)';
    const values = [evaluator_id, error_message, result_id, timestamp];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error('Error saving error evaluator:', error);
    }
}

export async function save_node(type: string, experiment_id: number, name:string, connection: mysql.Connection | mysql.Pool = pool): Promise<number> {
  try {
    const sql = 'INSERT INTO Node(type, experiment_id, name) VALUES (?, ?, ?)';
    const [result] = await connection.execute(sql, [type, experiment_id, name]);
    return (result as any).insertId;
  } catch (error) {
    throw error;
  }
}

export async function get_node_by_name(name: string, experiment_id: number, connection: mysql.Connection | mysql.Pool = pool): Promise<Experiment_node | undefined> {
  try {
    const sql = 'SELECT * FROM Node WHERE name = ? AND experiment_id = ?';
    const [rows] = await connection.execute(sql, [name, experiment_id]);
    if ((rows as any[]).length > 0) {
      return (rows as Experiment_node[])[0];
    }
    return undefined;
  } catch (error) {
    console.error('Error fetching node by name:', error);
  }
}

export async function save_link(source_node_id: number, target_node_id: number, source_var: string, target_var: string, connection: mysql.Connection | mysql.Pool = pool){
  try{
    const sql = 'INSERT INTO Link(source_node_id, target_node_id, source_var, target_var) VALUES (?, ?, ?, ?)';
    await connection.execute(sql, [source_node_id, target_node_id, source_var, target_var]);
  }
    catch (error) {
        console.error('Error saving link:', error);
    }
}

export async function get_configs_by_template_id(template_id: number, connection: mysql.Connection | mysql.Pool = pool): Promise<Promptconfig[]> {
  try {
    const sql = 'SELECT * FROM promptconfig WHERE prompt_template_id = ?';
    const [rows] = await connection.execute(sql, [template_id]);
    return rows as Promptconfig[];
  } catch (error) {
    console.error('Error fetching configs by template ID:', error);
    return [];
  }
}

export async function get_nodes_by_experiment(experiment_id: number){
  try{
    const sql = 'SELECT * FROM Node WHERE experiment_id = ?';
    const [rows] = await pool.execute(sql, [experiment_id]);
    return rows as Experiment_node[];
  }
    catch (error) {
        console.error('Error fetching nodes by experiment:', error);
        return [];
    }
}


/**
 * Fetches all links between nodes in a given experiment.
 * Only includes links where both source and target nodes belong to the same experiment.
 */
export async function get_links_by_experiment(experimentId: number): Promise<Link[]> {
  const query = `
        SELECT l.source_node_id, l.target_node_id, l.source_var, l.target_var
        FROM Link l
        JOIN Node src ON l.source_node_id = src.id
        JOIN Node tgt ON l.target_node_id = tgt.id
        WHERE src.experiment_id = ? AND tgt.experiment_id = ?
    `;

  const [rows] = await pool.execute(query, [experimentId, experimentId]);
  return rows as Link[];
}

export async function get_data_inputs_by_dataset(dataset_id: number): Promise<PromptVarsDict[]> {
  const sql = `
    SELECT
      di.id AS input_id,
      m.marker AS marker_name,
      mv.value AS marker_value
    FROM Data_Input di
    JOIN Input_marker im ON di.id = im.input_id
    JOIN Marker_value mv ON im.marker_values_id = mv.id
    JOIN Marker m ON mv.marker_id = m.id
    WHERE di.dataset_id = ?
    ORDER BY di.id ASC
  `;

  const [rows] = await pool.execute(sql, [dataset_id]);

  const grouped: Record<number, PromptVarsDict> = {};

  for (const row of rows as any[]) {
    const inputId = row.input_id;
    if (!grouped[inputId]) grouped[inputId] = {};
    grouped[inputId][row.marker_name] = row.marker_value;
  }

  return Object.values(grouped);
}

export async function update_final_dataset(config_id: number, dataset_id: number){
  try{
    await pool.execute('UPDATE promptconfig SET final_dataset_id = ? WHERE id = ?', [dataset_id, config_id]);
  }
    catch (error) {
        console.error('Error updating final dataset:', error);
    }
}

async function inputExists(node_id: number, input: PromptVarsDict): Promise<boolean> {
  // Step 1: Resolve marker_value_ids for the input
  const markerValueIds: number[] = [];

  for (const [marker, value] of Object.entries(input)) {
    const [markerRows] = await pool.execute(
        'SELECT id FROM Marker WHERE marker = ? AND dataset_id = ?',
        [marker, node_id]
    );
    if ((markerRows as any[]).length === 0) return false;
    const marker_id = (markerRows as any[])[0].id;

    const hash = computeMarkerValueHash(marker_id, value);
    const [valueRows] = await pool.execute(
        'SELECT id FROM Marker_value WHERE marker_id = ? AND hash = ?',
        [marker_id, hash]
    );
    if ((valueRows as any[]).length === 0) return false;

    markerValueIds.push((valueRows as any[])[0].id);
  }

  if (markerValueIds.length === 0) return false;

  // Step 2: Find inputs with the exact same marker values (no more, no less)
  const placeholders = markerValueIds.map(() => '?').join(',');

  const [rows] = await pool.execute(
      `
    SELECT im.input_id
    FROM Input_marker im
    GROUP BY im.input_id
    HAVING 
      COUNT(*) = ? AND
      SUM(im.marker_values_id IN (${placeholders})) = ?
    `,
      [markerValueIds.length, ...markerValueIds, markerValueIds.length]
  );

  return (rows as any[]).length > 0;
}

export async function add_rows_to_dataset(node_id: number, inputs: PromptVarsDict[]): Promise<void> {
  for (const input of inputs){
    // Check if input already exists
    const exists = await inputExists(node_id, input);
    if (exists) continue;

    const input_result = await pool.execute('INSERT INTO Data_Input (dataset_id) VALUES (?)', [node_id]);
    const input_id = (input_result[0] as any).insertId;
    for (const [marker, value] of Object.entries(input)){
      const marker_result = await pool.execute('SELECT id FROM Marker WHERE marker = ? AND dataset_id = ?', [marker, node_id]);
      let marker_id: number;
      if ((marker_result[0] as any[]).length === 0) {
        const insertMarker = await pool.execute('INSERT INTO Marker (marker, dataset_id) VALUES (?, ?)', [marker, node_id]);
        marker_id = (insertMarker[0] as any).insertId;
      } else {
        marker_id = (marker_result[0] as any[])[0].id;
      }
      const hash = computeMarkerValueHash(marker_id, value);
      const value_result = await pool.execute('SELECT id FROM Marker_value WHERE marker_id = ? AND hash = ?', [marker_id, hash]);
      let marker_value_id: number;
      if ((value_result[0] as any[]).length === 0) {
        const insertValue = await pool.execute('INSERT INTO Marker_value (marker_id, value) VALUES (?, ?)', [marker_id, value]);
        marker_value_id = (insertValue[0] as any).insertId;
      } else {
        marker_value_id = (value_result[0] as any[])[0].id;
      }
      await pool.execute('INSERT INTO Input_marker (input_id, marker_values_id) VALUES (?, ?)', [input_id, marker_value_id]);
    }
  }
}

export async function save_dataset_inputs(inputs: PromptVarsDict[], experiment_id: number){
  try{
    const uuid: string = crypto.randomUUID();
    const node_result = await pool.execute('INSERT INTO Node (type, experiment_id, name) VALUES (?, ?, ?)', ['dataset', experiment_id, uuid]);
    const node_id: number = (node_result[0] as any).insertId;
    await pool.execute('INSERT INTO Dataset (name, node_id) VALUES (?, ?)', [uuid, node_id]);
    await add_rows_to_dataset(node_id, inputs);
    return node_id;
  }
    catch (error) {
        console.error('Error saving dataset input:', error);
    }
}

/**
 * Retrieves the parent that are datasets of a given node.
 * @param node_id
 * @param type
 * @return An array of id of datasets that are parents of the given node.
 */
export async function get_parents(node_id: number, type: string): Promise<number[]>{
  try{
    const sql = `
    SELECT DISTINCT source_node_id FROM Link JOIN Node ON Link.source_node_id = Node.id WHERE Node.type = ? AND target_node_id = ?
    `;
    const [rows] = await pool.execute(sql, [type, node_id]);
    return (rows as any[]).map(row => row.source_node_id);
  }
    catch (error) {
        console.error('Error fetching parent datasets:', error);
        return [];
    }
}

export async function get_target_var(source_id: number, target_id: number, source_var: string){
  try{
    const sql = `SELECT target_var FROM Link WHERE source_node_id = ? AND target_node_id = ? AND source_var = ?`;
    const [rows] = await pool.execute(sql, [source_id, target_id, source_var]);
    if ((rows as any[]).length > 0) {
      return (rows as any[])[0].target_var;
    }
  }
    catch (error) {
        console.error('Error fetching target variable:', error);
    }
}

export async function get_processor_results_by_id(processor_id: number){
  try{
    const sql = 'SELECT * FROM processor_result WHERE processor_id = ?';
    const [rows] = await pool.execute(sql, [processor_id]);
    return rows as ProcessorResult[];
  }
    catch (error) {
        console.error('Error fetching processor results:', error);
        return [];
    }
}

export async function get_links_by_target(target_id: number){
  try{
    const sql = 'SELECT * FROM Link WHERE target_node_id = ?';
    const [rows] = await pool.execute(sql, [target_id]);
    return rows as Link[];
    }
    catch (error) {
        console.error('Error fetching links by target:', error);
        return [];
    }
}

export async function get_node_by_id(node_id:number){
    try {
        const sql = 'SELECT * FROM Node WHERE id = ?';
        const [rows] = await pool.execute(sql, [node_id]);
        if ((rows as any[]).length > 0) {
        return (rows as Experiment_node[])[0];
        }
        return undefined;
    } catch (error) {
        console.error('Error fetching node by ID:', error);
    }
}

export async function get_evaluator_by_id(evaluator_id: number){
  try{
    const sql = 'SELECT * FROM Evaluator WHERE node_id = ?';
    const [rows] = await pool.execute(sql, [evaluator_id]);
    if ((rows as any[]).length > 0) {
      return (rows as Evaluator[])[0];
    }
    return undefined;
  }
    catch (error) {
        console.error('Error fetching evaluator by ID:', error);
    }
}

export async function get_results_by_processor(processor_id: number){
  try{
    const sql = 'SELECT * FROM processor_result WHERE processor_id = ?';
    const [rows] = await pool.execute(sql, [processor_id]);
    return rows as ProcessorResult[];
  }
    catch (error) {
        console.error('Error fetching processor results:', error);
        return [];
    }
}

export async function get_result_by_id(result_id: number){
  try{
    const sql = 'SELECT * FROM result WHERE id = ?';
    const [rows] = await pool.execute(sql, [result_id]);
    if ((rows as any[]).length > 0) {
      return (rows as Result[])[0];
    }
    return undefined;
  }
    catch (error) {
        console.error('Error fetching result by ID:', error);
    }
}

export async function get_processor_by_id(processor_id: number){
    try{
        const sql = 'SELECT * FROM processor WHERE node_id = ?';
        const [rows] = await pool.execute(sql, [processor_id]);
        if ((rows as any[]).length > 0) {
        return (rows as ExperimentProcessor[])[0];
        }
        return undefined;
    }
        catch (error) {
            console.error('Error fetching processor by ID:', error);
        }
}

export async function save_error_processor(processor_id: number, error_message: string, result_id: number, input_id: number, timestamp: string){
  try{
    const sql = 'INSERT INTO error_processor(processor_id, error_message, result_id, input_id, timestamp) VALUES (?, ?, ?, ?, ?)';
    const values = [processor_id, error_message, result_id, input_id, timestamp];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error('Error saving error processor:', error);
    }
}

export async function save_process_result(processor_result: string, result_id: number, processor_id: number, input_id: number){
  try{
    const sql = 'INSERT INTO processor_result(processor_result, result_id, processor_id, input_id) VALUES (?, ?, ?, ?)';
    const values = [processor_result, result_id, processor_id, input_id];
    const [result] = await pool.execute(sql, values);
    return (result as any).insertId;
  }
    catch (error) {
        console.error('Error saving process result:', error);
    }
}

export async function get_processor_result_by_input_id(input_id: number, processor_id: number){
    try {
        const sql = 'SELECT * FROM processor_result WHERE input_id = ? AND processor_id = ?';
        const [rows] = await pool.execute(sql, [input_id, processor_id]);
        if ((rows as any[]).length > 0) {
        return (rows as ProcessorResult[])[0];
        }
        return undefined;
    } catch (error) {
        console.error('Error fetching processor result by input ID:', error);
    }
}

export async function get_processor_result_by_result_id(result_id: number, processor_id: number){
    try {
        const sql = 'SELECT * FROM processor_result WHERE result_id = ? AND processor_id = ?';
        const [rows] = await pool.execute(sql, [result_id, processor_id]);
        if ((rows as any[]).length > 0) {
            return (rows as ProcessorResult[])[0];
        }
        return undefined;
    } catch (error) {
        console.error('Error fetching processor result by result ID:', error);
    }
}