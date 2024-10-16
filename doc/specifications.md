# PromptStudio
PromptStudio is a tool to assist in engineering prompts for large language models. It allows you to run scientific experiments and a rigorous process to justify why you chose a particular prompt for a particular task. PromptStudio allows you to compare different prompts and the performance across different LLMs.
It is meant to be used for any application domain and task. However, it does not support conversational prompts. Each prompt sent is assumed to be indepdent of any previous prompt sent.

PromptStudio generalizes Gauransh's [PromptSLR](https://github.com/geodes-sms/PromptSLR).
A very related tool is [PromptFoo](https://www.promptfoo.dev/). It allows to connect to different LLMs and run prompt templates on many inputs. You can define your own metrics and your own evaluation of the result. Configurations are done using YAML. Prompt templates use [Nunjucks]https://mozilla.github.io/nunjucks/ syntax. It is an [open source project](https://github.com/promptfoo/promptfoo).

PromptStudio comprises 3 modules: designer, configurator, and analyzer.

# Prompt designer
The prompt designer offers a GUI to define the prompt in a way similar to template-based code generators.

[Portkey](https://docs.portkey.ai/docs/product/prompt-library/prompt-templates) has a good prompt template syntax, engine, and management (storage and versioning). It also has a good dashboard for analytics of sending queries, error detection, and error recovery.
The syntax is based on [Mustache](https://mustache.github.io/mustache.5.html). Although we could have used Mustache directly, it does not support labeling values needed for prompt configuration and comparative analysis.
[ChainForge](https://github.com/ianarawjo/ChainForge) is another related tool for testing prompts on different LLMs.

Prompt templates and marker indexes can be saved and versioned for future (re)use.
A prompt template has the following characteristics:
- **name**: a user-friendly name formatted as a variable name
- **ID**: internal GUID

## Static text
Static text is a collection of strings that are not analyzed and are processed as is.

## Dynamic text
Dynamic text is encoded in `{markers}`. A marker is a keyword that will be indexed as a variable for the experiments.
Here is an example of a prompt template:

```json
You are conducting a systematic review on {:topic}.
{persona}
{:scope}
Your task is to decide whether the following article should be included or not in the study based on the article's {feature*}.
{:shot {num_shots}}
Only answer {uncertainty} and nothing more.
{confidence}
Here is the information about the article:
Title: {:title}
Abstract: {:abstract}
```
### Syntax
The dynamic text follows a specific syntax:

**Input markers** in the form `{:marker}` indicate an input variable provided at run-time.

**Multi-valued marker** `{marker n}` indicates multiple values concatenated with a comma are allowed.

**Loops** in the form `{:marker n}` can be specified over input variables when the variable has a list of values.

In both cases, *n* specifies the number of iterations and can be any of the following:
- a number, to choose the first *n* values
- a marker representing numbers
- `*` to choose all the values
- `rand(n)` to randomly choose the number of (or all) values.

**Blocks** matching markers in the form `{marker<}some text{>marker}` encapsulate a block of text. The enclosed text will be rendered if `marker` evaluates to true or is not empty. `marker` is then assumed to be a boolean and does not need to be defined in the marker index. If it is defined as a non-boolean, it evaluates to false only if its value is empty.

**Boolean markers** can be negated in the form `{!marker<}some text{>marker}`. The marker evaluates to true only if its value is empty.

**Comments** are markers starting with `#` like `{#any comment}` and will be ignored.

**Sub templates** in the form `{@sub_template}` are injections of other templates referring to the template name.

**Template version** you can call a specific version of the prompt like so `{@sub_template@5}`, referring to version 5 of the `sub_template` template. By default, it calls the latest version.

## Marker index
For each marker `{marker}`, the marker index defines all the possible values it can hold: number, text. Each value has an optional unique **label** to identify it. The label is a string of a maximum of 5 characters.
No marker definition is specified for input variables.

Here is the marker definition for the example:
```json
persona = [
	SE: {You are an expert in software engineering.},
	ML: {You are an expert in machine learning.},
	SR: {You are an expert methodologist in systematic review.},
	No: {}
]
num_shots = [0, 1, 2, 3]
]
uncertainty = [
	U0: {Include or Exclude},
	U1: {Include, I don't know, or Exclude},
	U2: {Include, Maybe include, Maybe exclude, or Exclude},
	U3: {Include, Maybe include, I don't know, Maybe exclude, or Exclude}
]
confidence = [
	Conf: {On a scale of 1 to 10, state how confident you are in your decision.},
	NoConf: {}
]
feature = [
	T: {title},
	A: {abstract},
	B: {bibtex},
	K: {keywords}
]
```

> Note that we could have defined `features` without labels as `feature = [{title}, {abstract}, {bibtex}, {keywords}]`. However, labels are helpful to identify succintly which value was chosen in the other modules.

> Also, we could have specified the `confidence` in the prompt as: `{confidence<}On a scale of 1 to 10, state how confident you are in your decision.{>confidence}`. In this case, we would not have defined the `confidence` marker in the marker index.

> Any marker definition not used in the template will simply be ignored.
Note how we do not use `"` to encode strings to avoid escaping characters.

# Experiment configurator
The experiment configurator allows the user to configure a prompt, provide input datasets, and configure the models and other parameters.

## Input dataset
The input dataset is provided in tabular form `id, input1, input2, ...`
The `id` is used to refer to the exact row when reporting errors or fine-grained analysis results.
The `input` column name must match an `{:input}` marker in the prompt template. Additional columns will be ignored. If an `input` column is missing, the execution is halted, and an error is reported.

> The values in the input dataset are assumed to be encoded in UTF-8.

## Prompt configurator
It is based on the marker index and the prompt template. The user identifies which value(s) to choose for each marker based on its label. If no label was explicitly provided, a default label 1, 2, 3, ... is assigned to each value in the order they appear in the index. Unless it is a multi-valued marker, only one value can be assigned to each marker.

In the prompt configurator, the user can specify how to select shots or training data. Different options are available.

### For shots:
- A **shot dataset** *D* which can be the input dataset or a dedicated dataset for shots
- A number *n &isin; [ 0, |D| ]* shots
- Choose the first *n* rows in *D*
- Randomly choose *n* rows in *D*

### For training data:
- A shot dataset *D* (see above)
- A sample ratio *t* in the form of a percentage of *|D|*, default is 70%
- The vectorization method (e.g., Word2Vec, TF-IDF)
- The cross validation method (e.g., randomized, grid)
- The folding method (e.g., repeated, stratified, k-fold)

## Data pre-processing
By default, the data provided in a dataset is processed and loaded to the database as is.
Using a specific function signature, it is possible to specify how the data should be pre-processed before it is loaded into the database.
This may include reformatting, character encoding, or any other operation on each data provided in the input and shot datasets.
The data is provided in the form of a [pandas.DataFrame](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.html).

```python
'''
Modifies the pandas dataframe inplace loaded with the data from a dataset.
'''
def preprocess(dataframe):
  pass
```

## Output post-processing
By default, the result output by a model is processed and loaded to the database as is.
Using a specific function signature, it is possible to specify how the output should be post-processed before it is loaded into the database.
This may include reformatting, tokenization, truncation, or any other operation on the output.
The output is provided as a string. The entire result is also provided in case more context is required (for example, if an error/warning occurred).

```python
'''
Modifies the output received.
@param 	output	str		The text output by the model.
@param 	result	json	The whole result in JSON format.
'''
def postprocess(output, result):
  return output
```

## Result evaluation
The correspondance between the model's output and the expected oracle determines the confusion matrix outcome.
By default, the output and oracle must be exactly the same.
Using a specific function signature, it is possible to specify how the similarity between them, before storing the result of the evaluation in the database.
This may include arbitrary similarity computations that must output a boolean value.
Both the output and oracle are provided as strings.

```python
'''
Verifies how similar the output is to the oracle.
@param 	output	str		The text output by the model.
@param 	oracle	str		The expected result.
'''
def evaluate(output, oracle):
  return output == oracle
```

## Model selection
PromptStudio supports a variety of large language models, trainable models, and random to process the prompt and input dataset.
The out-of-the-box supported models are the ones listed below.

A model has the following characteristics:
- **ID**: internal GUID.
- **API**: the API family that the model is part of, such as "OpenAI" or "scikit-learn."
- **Model**: the specific model name, such as "gpt-3.5-turbo" or "svc."
- **Name**: a user-friendly name formatted as a variable name. If empty, the name is set to the model by default.
- **Parameters**: the hyperparameters set for this model.

### Large language models
- Commercial LLMs that require the user to provide the corresponding **key** (e.g., API key, Project ID)
	- OpenAI (GPT models)
	- Google AI (Gemini models)
	- Anthropic (Claude)
	- Meta (LLama)
- Mozilla AI Llamafile
- Models from HuggingFace

#### Hyperparameters
Specify the hyperparameters. The built-in parameters are:
- *Temperature:* between 0.0 and 2.0, varying the range of possible output tokens and influencing the model's creativity.
- *Maximum tokens:* maximum number of tokens in the output.

When the values of the parameters above are empty, the hyperparameters below have a finer control:
- *Top-p:* between 0.0 and 1.0, configuring a model to  sample the tokens with the highest probabilities until the sum of those  probabilities reaches the set value.
- *Top-k:* between 1 and 100, specifying that the tokens  sampled by the model should be those with the highest probabilities  until the set value is reached.
- *Stop sequence:* one or more characters that stop the output once they are produced.
- *Frequency penalty:* between -2.0 and 2.0, indicating that a model should avoid using the same tokens too often. It is applied proportionally to how often a specific token has been used. It prevents repetition.
- *Presence penalty:* between -2.0 and 2.0 is similar to the frequency penalty but only applies to tokens that have been used at least once. It encourages a broader assortment of tokens.

> Additional parameters can be defined manually.

### Trainable models
They are available in [scikit-learn](https://scikit-learn.org/)
- Linear model (Logistic regression)
- Naive Bayes (Complement NB and Multinomial NB)
- Support vector machine (C-Support Vector Classification)
- Ensemble model (Random Forest)

#### Hyperparameters
The hyperparameters of each trainable model must be defined manually.

### Random
- Seeded Random selection

#### Hyperparameters
Only the seed must be defined.

## Self-validation
When the model is an LLM, we can ask it to double-check its output. 
Here is the prompt that is used internally for to self-validate an output. However, the user can define another prompt.
```json
Your are an expert in {:validation_task:}.
Determine wether the output {:validation_result:} is correct based on the following instruction.
{:validation_instruction:}
Only answer {:validation_format:} and nothing more.
```
Here, note how the markers are formatted as `{:marker:}`. These are internal markers that are assigned a value automatically. If the internal marker is in the marker index, it will use that value. Note that in this case, it will always take the first value if multiple are provided. Otherwise, PromptStudio asks the LLM to determine the value based on the prompt when it is not present. Here are the internal markers available for self-validation:
- `{:validation_result:}` collects the value from the [*ExperimentResult* table](#results-1) in the `result` column.
- `{:validation_task:}` is determined by asking the LLM to summarize in one sentence the task based on the prompt provided in the [Prompt designer](#prompt-designer).
- `{:validation_instruction:}` is determined by asking the LLM to paraphrase the prompt provided in the [Prompt designer](#prompt-designer).
- `{:validation_format:}` investigates all the unique values from the [*ExperimentResult* table](#results-1) in the `result` column.

Self-validation is characterized by:
- A **validation prompt** which is either the default one or user-defined. Note that the markers may or may not be defined in the marker index.
- A **validation model** that will perform the validation. By default, it is the same model chosen during [model selection](#model-selection).
- The number of **validation iterations**: for self-consistency and statistical power.

The self-validation results are stored in a separate *Experiment validation* table and can be analyzed like the original results.

## Experiment setup
An experiment is characterized by:
- An **ID**: internal GUID.
- The number of **iterations**: for self-consistency and statistical power.
- A configuration **tag**: constructed from prompt configuration, input dataset, model selected, and iteration.
Its format follows: `{template.name}|{model.name}|{input_dataset.label}(|{marker.label})*(_{iterations})?`.
For example, `slr|gpt-3.5-turbo|DSLCompo|SE|0|U2|NoConf|T+A_10` reads as follows: the *slr* template and the *DSMLCompo* input dataset; the prompt is configured with the labels *role_play = SE*, *num_shots = 2*, *uncertainty = 0*, *confidence = NoConf*, and *features = [T,A]*; the experiment will be repeated in 10 iterations. If the tag already exists, it will be suffixed by .1, .2, .3, ... Any boolean marker not defined in the marker index will have values `T` if true, `F` otherwise.
- A user-friendly **title**: must be unique and serves as ID. The title will be set to the tag if no title is provided.
- A **status**: which can be *draft* (if not run yet), *running* (if its execution is in progress), and *completed* (if its execution has terminated).

Several options are also available when setting up the experiment:

**Self-validation**: can be enabled or disabled [(see Self-validation)](#self-validation). In this case, another result and confusion matrix outcome is stored in the database.

**Synchronicity**: to run requests synchronously  or asynchronously. The latter is the default.

**Threads**: to run requests on multiple threads. The default is 10.

**Bacth mode**: when available in the model's API, run the input dataset in batch. False is the default. For example, [OpenAI's Batch API](https://platform.openai.com/docs/guides/batch)

**Stop upon error**: whether to stop the experiment on the first error or proceed with the next request. False is the default.

**Retry upon error**: whether to automatically retry requests still in error after completing the input dataset. False is the default.

**Maximum retries**: the number of attempts a request with error must be retried. This prevents an infinite number of retries. The default is 1.

**Tokens per minute**: to set a maximum number of tokens sent per minute and comply with the API's limitations.

**Tokens per day**: to set a maximum number of tokens sent per minute and comply with the API's limitations.

**Requests per minute**: to set a maximum number of requests sent per minute and comply with the API's limitations.

**Requests per day**: to set a maximum number of requests sent per day and comply with the API's limitations.

**Batch queue limit**: to set a maximum number of tokens in queue when in batch mode and comply with the API's limitations.

> Note that it is possible to re-configure and re-run a completed experiment.


# Experiment analyzer
PromptStudio allows you to analyze the results of previously run experiments. When an experiment is completed, it is available for analysis. Once the analysis is run on an experiment, all the analysis results are stored for faster retrieval in the future. Several analysis visualizations are available.

A configuration selector enables the selection of the experiments that match the given configuration. For example, the user may choose all the values of a template marker (say *uncertainty*) and a given model (say *gpt-3.5-turbo*). Then, all the experiments that match that will be selected.

> Note that any reported analysis can be exported as CSV or graphical plots.

> When self-validation is enabled, the user can decide to view the analysis results of either the original results or the results of the validation.

## Dashboard
The dashboard enables to inspect how the experiment went. It reports the following information about the entire experiment and each iteration, when applicable.
These are available in tabular format and plots (*line*, *bar*, *box*, and *gauge*).

- The **start** time, **end** time, and **duration**
- The number of **iterations** completed
- The number of **tokens** used
- The total number of **requests** and **ratio** with the number of data (rows in the input dataset)
- The frequency of **latency per request** and the average
- The frequency of **tokens per request** and the average
- The number of **successful requests** and **requests with errors** (errors are when errors are still present after the experiment is complete)
- The frequency of **retries** (among the requests with errors) and the average
- The frequency of **error messages** ranked from the most to the least encountered
- The frequency of **requests per minute** and the average
- The frequency of **requests per day** and the average
- The frequency of **tokens per minute** and the average
- The frequency of **tokens per day** and the average

## Results
The analyzer reports the aggregate results. 
- The number of **processed** data and **unprocessed** data (i.e., with errors).
- The count and frequency of each **result group** (unique result values).
- The **confusion matrix** (TP, TN, FP, FN) comparing the result the model has output with the oracle column in the input dataset.

## Statistics
Different metrics are available to be computed. PromptStudio reports the descriptive statistics for each selected metric in a tabular format.
All metrics are normalized on a scale from 0% to 100% with 2 decimal points. 
The supported metrics are:
- *Accuracy*
- *Area Under the Curve*
- *Balanced Accuracy*
- *Cohen's Kappa*
- *F-Beta Score* (&beta; is a parameter)
- *Geometric Mean*
- *General Performance Score*
- *Jaccard Index*
- *Matthews Correlation Factor*
- *Negative Likelihood*
- *Negative Predictive Value*
- *Positive Likelihood*
- *Precision*
- *Recall* (also called *Sensitivity*)
- *Specificity*
- *Youden's Index*

> Additional metrics can be defined as plug-ins.

When the experiment comprises of a single iteration, one value is reported for each metric. 
When the experiment includes multiple iterations, the moment statistics is reported for each metric.
The supported moment statistics are:
- *Mean*
- *Standard Deviation*
- *Median*
- *Inter-Quartile Range*
- *Skewness*
- *Kurtosis*
- *Fleiss kappa* (although it is not a moment statistics)

## Plots
PromptStudio visualizes plots for the selected metrics to assist users in further analyzing them.

The user can compare different metrics in the same *column chart*.
A *radar chart*, *parallel coordinates plot*, *facet grid/scatter matrix*, or *heat map* enables the comparison of multiple metrics within the same experiment or across multiple experiments. If the experiment has multiple iterations, moment statistics to aggregate the metric values are needed. If only two metrics are chosen, the comparison can be displayed in a *scatter plot* by specifying the metrics for the *x* and *y* axes.

The confusion matrix can also be displayed in a *column chart*, *stacked bar chart*, or *heat map*.
A *box plot* is displayed for each metric when the experiment includes multiple iterations.

## Comparative analysis
Multiple experiments can be selected to compare their results. This is useful if the user wants to compare different prompts for the same model, different models for the same prompt, different input datasets for the same model and prompt, etc.

PromptStudio enables the comparison of different experiments for a fixed *series*. A series can be any of the following:
- the prompt
- the model
- the input dataset

The plot type available is determined as per [above](#plots). Univariate, bivariate, and multivariate analyses are supported.

## Analysis interpretation
For the dashboard, results, statistics, and plots, PromptStudio can automatically query an LLM to interpret the analysis produced. The user can select which analysis unit to interpret.

The analysis interpretation is characterized by:
- The **analysis unit** is an element currently available in the analysis view. This can be:
	- a metric (for dashboard, results, and statistics/plots)
	- the result table (for results)
	- a result row (for results)
	- one or more series (for comparative analysis)
- An **interpretation prompt** which is either the default one or user-defined. Note that the markers may or may not be defined in the marker index.
- An **interpretation model** that will perform the interpretation. By default, it is the same model chosen during [model selection](#model-selection) if the model is an LLM.

Here is the prompt that is used internally for to interpret the analysis. However, the user can define another prompt.
```json
You have already performed the task of {:analysis_task:}.
Given the {:analysis_unit:}, interpret the results based on the data provided below.
The data shows {:analysis_description:}.
Summarize your interpretation in a paragraph of at most {:analysis_word_length:} words.
{:analysis_data:}
```

The internal markers are assigned a value automatically. If the internal marker is in the marker index, it will use that value. Note that in this case, it will always take the first value if multiple are provided. Otherwise, PromptStudio asks the LLM to determine the value based on the prompt when it is not present. Here are the internal markers available for analysis interpretation:
- `{:analysis_task:}` is determined by asking the LLM to summarize in one sentence the task based on the prompt provided in the [Prompt designer](#prompt-designer).
- `{:analysis_description:}` is determined by asking the LLM to paraphrase the prompt provided in the [Prompt designer](#prompt-designer).
- `{:analysis_unit:}` is the unit selected by the user.
- `{:analysis_data:}` collects the appropriate information from the [*ExperimentResult* table](#results-1) based on the analysis unit.

## Querying the results
Instead of analyzing aggregate results, individual results for each data record in the input dataset can be investigated.
A `Result` view is available for read-only MySQL queries.

| Experiment | Iteration | Input Dataset | Prompt | Model | Input 1 | Input 2 | ... | Oracle | Result | Confusion Class | Latency | Token Count | Error | Retries |
|------------|-----------|---------------|--------|-------|---------|---------|-----|--------|--------|-----------------|---------|-------------|-------|---------|
|            |           |               |        |       |         |         |     |        |        |                 |         |             |       |         |

Here is an example query to retrieve some information from iteration 1 of an experiment.
```sql
SELECT title, abstract, oracle, result, confusion_class
FROM Result
WHERE error IS NULL AND experiment_id = {some_guid} AND iteration = 1
```

Here is another example to count all the false negatives for each iteration.
```sql
SELECT iteration, COUNT(confusion_class) AS FN
FROM Result
WHERE error IS NULL AND experiment_id = {some_guid} AND confusion_class = 'FN'
GROUP BY iteration
```

Here is a final example to analyze the requests with errors.
```sql
SELECT iteration, prompt, model, title, abstract, oracle, token_count, error, retries
FROM Result
WHERE error IS NOT NULL AND experiment_id = {some_guid}
```

# Architecture
The high-level 3-tier architecture is as follows.

### Data
We assume a MySQL database storing the following entities on the data tier.

##### Input
- *Prompt templates*(id, static, marker, input, sub_template, version)
- *Marker index*(id, prompt_template, marker) and *Marker value*(marker, label, value)
- *Input datasets*(id, name) and *Input values*(id, input_dataset, oracle, input1, input2, ...)

##### Configuration
- *Prompt configuration*(prompt_template, llm, llm_parameters) and *Marker assignment*(marker_id, value)
- *LLM*(id, base_model, version, timestamp), *LLM parameters*(temperature, top_p, hyperparameters), *Random*(seed), *Trainable model*(training_ratio, training_model, hyperparameters), *Training mode*(cross_over, ...)
- *Experiment*(id, title, tag, prompt_configuration, num_iterations, input_dataset, llm_model, llm_parameters, trainable_model, training_mode, status, datetime, total_requests), *Experiment mode*(experiment, options, input_preprocessing, output_postprocessing), and *Validation* (id, experiment, validation_prompt, num_iterations, llm_model, llm_parameters, trainable_model, training_mode, status, datetime, total_requests)

##### Results
- *Experiment results*(experiment, iteration, input_id, result, evaluation, duration, token_count, error, latency), *Experiment validation*(validation, experiment_result, iteration, result, evaluation, duration, token_count, error, latency) and *Error log*(experiment, input_id, code, reason)
- *Measurement*(experiment, metric1, metric2, ...)
- *Comparative statistics*(experiment, metric1, metric2, ...)

### Logic
A Python 3.10+ API to define prompts, configure an experiment, and analyze experiment results.
The libraries to consider are:
- [asyncio](https://docs.python.org/3/library/asyncio.html)
- [configparser](https://docs.python.org/3/library/configparser.html)
- [Flask](https://flask.palletsprojects.com/en/3.0.x/)
- [jinja](https://palletsprojects.com/projects/jinja/)
- [matplotlib](https://matplotlib.org/)
- [pandas](https://pandas.pydata.org/)
- [scikit-learn](https://scikit-learn.org/)
- [scipy](https://docs.scipy.org/doc/scipy/index.html)
- [seaborn](https://seaborn.pydata.org/)


The main features are:
- Template parser and engine
- Validation of all input artifacts and data
- Plug-and-play of LLM APIs, including HuggingFace and commercial models
- Training of supervised machine learning models
- Multi-threaded, asynchronous requests to models
- Transactional modification of the database
- Fault tolerance, error handling, and recovery of individual requests.
- Result and error logging
- Compute metrics for individual results and aggregate for experiment/iteration
- Metrics adapted to the given experiment setup and custom metrics
- Comparative statistics adapted to selected data
- Support for self-validation of the results
- Support for automated interpretation of the analysis
- Import configuration and templates in JSON
- Export configuration and templates to JSON
- Export experiment results in tabular form
- Direct read-only query of the whole database

### Presentation
PromptStudio is a web-based application that can run headless from the command line.

#### Web GUI
Like PromptSLR, PromptStudio has a menu on the left to navigate the different modules. Each module has multiple tabs on the top, grouping related features. At the bottom, navigation buttons drive the user through the workflow.
Consider using [Flask](https://flask.palletsprojects.com/en/3.0.x/) to integrate Python, HTML, and Javascript seamlessly.
For the plots, consider using either [seaborn](https://seaborn.pydata.org/) or [Highcharts](https://www.highcharts.com/).

##### Prompt designer
The prompt template and marker index can be loaded from a file and edited in the UI.
Use plain text input with syntax highlighting or a projectional editor like Gentleman. Alternatively, offer to add a line, which can be static or dynamic.

For the marker index, a button adds the missing markers from the prompt template. The user adds values and optionally labels each marker.

A validate button ensures that the prompt template, marker index, and input dataset (this is optional; they can upload one for validation purposes only) are consistent with each other: missing markers, unused markers, unused input columns, and marker type.

##### Experiment configurator
The UI should show all the markers based on the marker index, and the user should select the values using radio buttons. Only the value's label is displayed. Hovering over displays the value. Each radio button group (for each marker) is displayed in a color. A checkbox group is used in the case of a multi-valued marker.

Below all the radio buttons, a text field shows the actual prompt that will be used. Only `{:input}` markers will remain. Each marker has a color code from a standard palette of 20 colors (passed 20, we resume back to the first color). The rendered dynamic text is displayed in the color corresponding to its marker. The coloring option can be toggled on/off.

When choosing the model, the UI form adapts to the configuration required for this model. Additional hyperparameters not built-in can also be provided.

A test button allows the user to run a test on the first row of the input dataset with all the configurations setup.

When an experiment is running, a progress bar should be displayed. In the experiment analyzer, we can check the results while the experiment is still in progress.

Users can turn self-validation on. They can define the prompt, select the model and configure it, and define the number of iterations.

##### Experiment analyzer

The dashboard can be toggled to be updated live while the experiment is running (i.e., monitoring the progress) or to show the information after the experiment is complete.

The user can choose the format to display the results: in tabular form or the plot type.

Appropriate selectors for experiments, metrics, and moment statistics should be available. For comparative analysis, the user can select the series to control the markers and colors in the plot. Note that checkbox groups must be available to select all interesting experiments.

The user can inspect the `Result` view with pre-determined filters such as processed/unprocessed data, result group, and confusion matrix value (see [Results](#results)).
They can also write a query directly. The query result is displayed in tabular format.

All the information can be exported to a CSV file or seaborn plots.

#### Headless CLI
To use PromptStudio in headless mode, you can run the following command in the command line interface:
```cmd
> python promptstudio.py -headless -config my_config.ini
```
It requires the `headless` argument and a configuration file.
The file is in the *.ini* format and has all the following configuration options.
Here is a sample:
```ini
[PROMPT]
# Use only if you want to create a new prompt template otherwise keep this section empty or commented out

prompt_template_file = "path_to_your_prompt_template_file"
marker_index_file = "path_to_your_prompt_template_file"

######################

[CONFIGURATION]
# Use only if you want to create a new prompt template otherwise keep this section empty or commented out

input_dataset_file = "path_to_your_input_dataset_file"

# Shots are optional
shot_dataset_file = "path_to_your_shot_dataset_file"
num_shots = 0
;shot_selection = "first" or "random"

# For training data
; traing_set_ratio = 70
; vectorization_method =
; ...

preprocess_file = "path_to_your_preprocessing_file"
postprocess_file = "path_to_your_postprocessing_file"

# Model selection
api = "OpenAI"						# if empty then it is a trainable model
model = "gpt-3.5-turbo"		# if "random" then api is ignored
;key =										# API key, Project ID, ...

# Only for LLM (if api is not empty)
temperature = 0.1					# between 0.0 and 1.0
;top_p = 
;top_k = 
;max_tokens = 
;stop_sequence =
;frequency_penality =
;presence_penality =

# For LLM and trainable models
;additional_parameters = {
		"param": "value",
		"param": "value"
	}

######################

[EXPERIMENT]
# Use only if you want to run a new experiment otherwise keep this section empty or commented out

title = "My experiment"
iterations = 1
async = true
threads = 10
batch_mode = false
stop_at_first_error = false
retry_on_error = true
max_retry = 1

# Limits
;tokens_per_minute = 
;tokens_per_day = 
;requests_per_minute = 
;requests_per_day = 
;batch_queue_limit = 

######################

[VALIDATION]
# If validation is false, all the other parameters related to validation will be ignored
validation = false
validation_prompt_file = "path_to_your_validation_prompt_file"
validation_iterations = 1

# If use_same_model is true, all the other parameters related to model validation will be ignored
use_same_model = true
validation_api = "OpenAI"						# if empty then it is a trainable model
validation_model = "gpt-3.5-turbo"		# if "random" then api is ignored
;validation_key =										# API key, Project ID, ...

# Only for LLM (if api is not empty)
validation_temperature = 0.1					# between 0.0 and 1.0
;validation_top_p = 
;validation_top_k = 
;validation_max_tokens = 
;validation_stop_sequence =
;validation_frequency_penality =
;validation_presence_penality =

# For LLM and trainable models
;validation_additional_parameters = {
		"param": "value",
		"param": "value"
	}

######################

[ANALYSIS]
# Use only if you want to save analysis otherwise keep this section empty or commented out
# Support for single experiment analysis only. Use the GUI for comparative analysis across experiments.

# Use either the experiment_tag or the experiment_id.
# If both are empty, then it will analyze the latest experiment that was run (i.e., the one specified in the [EXPERIMENT] section).
experiment_tag = slr-DSLCompo-SE-2-0-F-T+A_10		# to compare multiple experiments, separate them with a comma
experiment_id =				# if you know it instead

export_path = .

# Choose between ALL, enumerate separated by commas, or keep empty
;dashboard_table = ALL
;dashboard_plot = 

metric_table = ALL

univariate_plot = box, pie, bar			# this will produce one diagram for each metric and plot type
univariate_plot_var = precision, recall, bacc, mcc, spec

bivariate_plot = {
		"line": {"x": "recall","y": "spec"},
		"scatter": {"x": "bacc","y": "mcc"}
	}
```

> The headless mode supports most features. However, analysis can only be performed on a single experiment. Use the GUI for comparative analysis across experiments, interpretation, and querying.