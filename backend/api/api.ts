// @ts-ignore
import express from 'express';
import {
    get_dataset_by_id,
    get_dataset_by_name,
    get_dataset_size,
    get_experiment_by_name,
    get_last_input_id,
    get_llm_by_base_model,
    get_llm_by_id,
    get_llm_param_by_id,
    get_marker_by_id,
    get_next_input,
    get_prompt_config_by_experiment,
    get_results,
    get_template_by_id,
    get_template_by_name,
    save_dataset,
    save_error,
    save_evaluator,
    save_evaluator_config,
    save_experiment,
    save_llm,
    save_llm_param,
    save_promptconfig,
    save_response,
    save_template,
    get_evaluator_by_name,
    get_results_by_config,
    get_evaluators_by_config,
    get_input_by_id,
    update_promptconfig_final_dataset,
    save_combination_as_input,
    get_all_input_ids_from_dataset,
    get_or_create_synthetic_dataset,
    get_results_by_template,
    get_config,
    update_template_vars,
    add_config_base_dataset,
    get_base_datasets
} from "../database/database";
// @ts-ignore
import multer from 'multer';
import {Evaluator, Experiment} from "./types";

const app = express();
const port = 3000;

app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Save a dataset
app.post('/dataset/:name/:template_id', upload.single('file'), async (req, res) => {
    try{
        const dataset_name = req.params.name;
        const template_id = req.params.template_id;
        const file_path = req.file.path;
        const dataset_id = await save_dataset(file_path, dataset_name, template_id);

        res.status(201).json({ dataset_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get prompt configurations by experiment ID
app.get('/promptconfig', async (req, res) => {
    try {
        const experiment_id = req.query.experiment;
        const configs = await get_prompt_config_by_experiment(experiment_id);
        res.json(configs);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Save a prompt configuration
app.post('/promptconfig', async (req, res) => {
    try{
        const { experiment_id, llm_id, llm_param_id, template_id, dataset_id } = req.body;
        const config_id = await save_promptconfig(experiment_id, llm_id, llm_param_id, template_id, dataset_id);
        res.status(201).json({ config_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Save a template
app.post('/template', async (req, res) => {
    try{
        const { template, name, vars } = req.body;
        const template_id = await save_template(template, name, vars);
        res.status(201).json({ template_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get experiment by name
app.get('/experiment/:name', async (req, res) => {
    try{
        const experiment_name = req.params.name;
        const experiment = await get_experiment_by_name(experiment_name);
        if (experiment) {
            res.json(experiment);
        } else {
            res.status(404).json({ error: 'Experiment not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Save an experiment
app.post('/experiment', async (req, res) => {
    try{
        const { experiment } = req.body;
        const experiment_id = await save_experiment(experiment as Experiment);
        res.status(201).json({ experiment_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get LLM by ID
app.get('/llm/:id', async (req, res) => {
    try{
        const llm_id = req.params.id;
        const llm = await get_llm_by_id(llm_id);
        if (llm) {
            res.json(llm);
        } else {
            res.status(404).json({ error: 'LLM not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Save an LLM
app.post('/llm', async (req, res) => {
    try{
        const { llm } = req.body;
        const llm_id = await save_llm(llm);
        res.status(201).json({ llm_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get LLM parameters by ID
app.get('/llm_param/:id', async (req, res) =>  {
    try{
        const llm_param_id = req.params.id;
        const llm_param = await get_llm_param_by_id(llm_param_id);
        if (llm_param) {
            res.json(llm_param);
        } else {
            res.status(404).json({ error: 'LLM parameter not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Save LLM parameters
app.post('/llm_param', async (req, res) => {
    try{
        const { llm_param } = req.body;
        const llm_param_id = await save_llm_param(llm_param);
        res.status(201).json({ llm_param_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get template by ID
app.get('/template/:id', async (req, res) => {
    try{
        const template_id = req.params.id;
        const template = await get_template_by_id(template_id);
        if (template) {
            res.json(template);
        } else {
            res.status(404).json({ error: 'Template not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get template by name
app.get('/template/name/:name', async (req, res) => {
    try{
        const template_name = req.params.name;
        const template = await get_template_by_name(template_name);
        if (template) {
            res.json(template);
        } else {
            res.status(404).json({ error: 'Template not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get dataset by ID
app.get('/dataset/:id', async (req, res) => {
    try{
        const dataset_id = req.params.id;
        const dataset = await get_dataset_by_id(dataset_id);
        if (dataset) {
            res.json(dataset);
        } else {
            res.status(404).json({ error: 'Dataset not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get dataset by name
app.get('/dataset/name/:name', async (req, res) => {
    try{
        const dataset_name = req.params.name;
        const dataset = await get_dataset_by_name(dataset_name);
        if (dataset) {
            res.json(dataset);
        } else {
            res.status(404).json({ error: 'Dataset not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get next input for a dataset
app.get('/input/:dataset_id/:input_id', async (req, res) => {
    try{
        const dataset_id = req.params.dataset_id;
        const input_id = req.params.input_id;
        const input = await get_next_input(dataset_id, input_id);
        if (input) {
            res.json(input);
        } else {
            res.status(404).json({ error: 'Input not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get marker by ID
app.get('/marker/:id', async (req, res) => {
    try{
        const marker_id = req.params.id;
        const marker = await get_marker_by_id(marker_id);
        if (marker) {
            res.json(marker);
        } else {
            res.status(404).json({ error: 'Marker not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Save a response
app.post('/result', async (req, res) => {
    try{
        const {config_id, output_result, input_id, start_time, end_time, total_tokens} = req.body;
        const response_id = await save_response(config_id, output_result, input_id, start_time, end_time, total_tokens);
        res.status(201).json({ response_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

// Get last input ID for a dataset
app.get('/last_input/:dataset_id', async (req, res) => {
    try{
        const dataset_id = req.params.dataset_id;
        const last_input_id = await get_last_input_id(dataset_id);
        if (last_input_id) {
            res.json(last_input_id);
        } else {
            res.status(404).json({ error: 'Last input not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Save an error
app.post('/error', async (req, res) => {
    try{
        const { config_id, error_message, error_status, input_id, start_time, end_time } = req.body;
        const error_id = await save_error(config_id, error_message, error_status, input_id, start_time, end_time);
        res.status(201).json({ error_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get results for a specific configuration and input
app.get('/results', async (req, res) => {
    try{
        const { config_id, input_id } = req.query;
        const results = await get_results(Number(config_id), Number(input_id));
        res.json(results);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get LLM by base model
app.get('/llm/base_model/:base_model', async (req, res) => {
    try{
        const base_model = req.params.base_model;
        const llm = await get_llm_by_base_model(base_model);
        if (llm) {
            res.json(llm);
        } else {
            res.status(404).json({ error: 'LLM not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get dataset size by ID
app.get('/dataset/size/:dataset_id', async (req, res) => {
    try{
        const dataset_id = req.params.dataset_id;
        const size = await get_dataset_size(dataset_id);
        res.json({ size });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Save evaluator configuration
app.post('/evaluator_config', async (req, res) => {
    try{
        const evaluator_id= req.body.evaluator_id;
        const config_id = req.body.config_id;
        await save_evaluator_config(evaluator_id, config_id);
        res.status(201).json({ message: 'Evaluator config saved successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Save an evaluator
app.post('/evaluator', async (req, res) => {
    try{
        const { evaluator } = req.body;
        const evaluator_id = await save_evaluator(evaluator as Evaluator);
        res.status(201).json({ evaluator_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get evaluator by name
app.get('/evaluator/:name', async (req, res) => {
    try{
        const name = req.params.name;
        const evaluator = await get_evaluator_by_name(name);
        if (evaluator) {
            res.json(evaluator);
        } else {
            res.status(404).json({ error: 'Evaluator not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get Results by configuration ID
app.get('/results/config/:config_id', async (req, res) => {
    try{
        const config_id = req.params.config_id;
        const results = await get_results_by_config(config_id);
        res.json(results);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get Evaluators by configuration ID
app.get('/evaluator/config/:config_id', async (req, res) => {
    try{
        const config_id = req.params.config_id;
        const evaluators = await get_evaluators_by_config(config_id);
        res.json(evaluators);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

// Get Input by ID
app.get('/input/:input_id', async (req, res) => {
    try{
        const input_id = req.params.input_id;
        const input = await get_input_by_id(input_id);
        if (input) {
            res.json(input);
        } else {
            res.status(404).json({ error: 'Input not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.put('/promptconfig/:config_id', async (req, res) => {
    try{
        const config_id = req.params.config_id;
        const { dataset_id } = req.body;
        await update_promptconfig_final_dataset(config_id, dataset_id);
        res.status(200).json({ message: 'Prompt configuration updated successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.post('/input/combination', async (req, res) => {
    try{
        const { dataset_id, config_id, markers } = req.body;
        const input_id = await save_combination_as_input(dataset_id, config_id, markers);
        res.status(201).json({ input_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.get('/inputs/:dataset_id', async (req, res) => {
    try{
        const dataset_id = req.params.dataset_id;
        const input_ids = await get_all_input_ids_from_dataset(dataset_id);
        res.json(input_ids);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.post('/dataset/synthetic', async (req, res) => {
    try{
        const { base_name, dependencies } = req.body.params;
        const dataset_id = await get_or_create_synthetic_dataset(base_name, dependencies);
        res.status(201).json({ dataset_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.get('/results/template/:template_id', async (req, res) => {
    try{
        const template_id = req.params.template_id;
        const results = await get_results_by_template(template_id);
        res.json(results);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.get('/promptconfig/:config_id', async (req, res) => {
    try{
        const config_id = req.params.config_id;
        const config = await get_config(config_id);
        if (config) {
            res.json(config);
        } else {
            res.status(404).json({ error: 'Prompt configuration not found' });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.put('/template/:template_id', async (req, res) => {
    try{
        const template_id = req.params.template_id;
        const { vars } = req.body;
        await update_template_vars(template_id, vars);
        res.json({message: 'Template vars updated'});
    }
    catch(error){
        console.error(error);
        res.status(500).json({error: 'Internal Server Error'});
    }
})

app.post('/config_base_dataset', async (req, res) => {
    try{
        const { config_id, dataset_id } = req.body;
        await add_config_base_dataset(config_id, dataset_id);
        res.status(200).json({ message: 'Configuration base dataset updated successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})

app.get('/config_base_dataset/:config_id', async (req, res) => {
    try{
        const config_id = req.params.config_id;
        const base_datasets = await get_base_datasets(config_id);
        res.json(base_datasets);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
})



app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
