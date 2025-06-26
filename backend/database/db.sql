DROP DATABASE promptstudio;

CREATE DATABASE promptstudio;

USE promptstudio;

CREATE TABLE Experiment(
    id int UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL UNIQUE,
    iterations int NOT NULL DEFAULT 1,
    datetime TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    total_requests INT UNSIGNED NOT NULL DEFAULT 0,
    max_retry INT UNSIGNED NOT NULL DEFAULT 0,
    threads INT UNSIGNED NOT NULL DEFAULT 1,
    CONSTRAINT PK_Experiment PRIMARY KEY (id),
    CHECK ( iterations > 0 ),
    CHECK ( max_retry >= 0 )
);

CREATE INDEX idx_experiment_title ON Experiment(title);

CREATE TABLE Llm(
    id int UNSIGNED NOT NULL AUTO_INCREMENT,
    base_model VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    model VARCHAR(255) NOT NULL,
    CONSTRAINT PK_Llm PRIMARY KEY (id)
);

CREATE INDEX idx_llm_base_model ON Llm(base_model);

CREATE TABLE Llm_param(
    id int UNSIGNED NOT NULL AUTO_INCREMENT,
    temperature float,
    max_tokens INT UNSIGNED,
    top_p float,
    top_k INT UNSIGNED,
    stop_sequence TEXT,
    frequency_penalty float,
    presence_penalty float,
    CONSTRAINT PK_Llm_param PRIMARY KEY (id),
    CHECK ( temperature >= 0 AND temperature <= 2 ),
    CHECK ( max_tokens > 0 ),
    CHECK ( top_p >= 0 AND top_p <= 1 ),
    CHECK ( top_k >= 1 AND top_k <= 100 ),
    CHECK ( frequency_penalty >= -2 AND frequency_penalty <= 2 ),
    CHECK ( presence_penalty >= -2 AND presence_penalty <= 2 )
);

CREATE TABLE Llm_custom_param(
    name VARCHAR(255) NOT NULL,
    value VARCHAR(255) NOT NULL,
    llm_param_id int UNSIGNED NOT NULL,
    CONSTRAINT PK_Llm_custom_param PRIMARY KEY (name, llm_param_id),
    CONSTRAINT FK_llm_param FOREIGN KEY (llm_param_id) REFERENCES Llm_param(id)
);

-- If a prompt name is already used, create name_1, name_2, etc.
CREATE TABLE PromptTemplate(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    value TEXT NOT NULL,
    name varchar(255) UNIQUE NOT NULL,
    CONSTRAINT PK_Prompt_Template PRIMARY KEY (id)
);

-- We should check that we don't have a 2 way relation
CREATE TABLE sub_template(
    main_template_id INT UNSIGNED NOT NULL,
    sub_template_id INT UNSIGNED NOT NULL,
    var_name varchar(255) NOT NULL,
    CONSTRAINT FK_main_template_id FOREIGN KEY (main_template_id) REFERENCES PromptTemplate(id),
    CONSTRAINT FK_sub_template_id FOREIGN KEY (sub_template_id) REFERENCES PromptTemplate(id),
    CONSTRAINT CHK_same_template CHECK (main_template_id != sub_template_id),
    CONSTRAINT PK_Sub_Template PRIMARY KEY (main_template_id, sub_template_id)
);

CREATE INDEX idx_prompt_template_name ON PromptTemplate(name);

CREATE TABLE Marker(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    marker varchar(255) NOT NULL,
    template_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Marker PRIMARY KEY (id),
    CONSTRAINT FK_template_id FOREIGN KEY (template_id) REFERENCES PromptTemplate(id),
    CONSTRAINT unique_marker_template UNIQUE(marker, template_id)
);

CREATE TABLE Marker_value(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    marker_id INT UNSIGNED NOT NULL,
    value TEXT NOT NULL,
    hash CHAR(64) GENERATED ALWAYS AS (SHA2(CONCAT(marker_id, value), 256)) STORED,
    CONSTRAINT PK_Marker_value PRIMARY KEY (id),
    CONSTRAINT FK_marker_id FOREIGN KEY (marker_id) REFERENCES Marker(id),
    CONSTRAINT unique_marker_hash UNIQUE(hash)
);

CREATE TABLE Evaluator(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    type ENUM('simple', 'javascript', 'python') NOT NULL,
    code TEXT,
    name VARCHAR(255) NOT NULL UNIQUE,
    CONSTRAINT PK_Evaluator PRIMARY KEY (id)
);

CREATE TABLE Dataset(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    CONSTRAINT PK_Dataset PRIMARY KEY (id)
  );

CREATE INDEX idx_dataset_name ON Dataset(name);

CREATE TABLE PromptConfig(
    id int UNSIGNED NOT NULL AUTO_INCREMENT,
    experiment_id int UNSIGNED NOT NULL,
    LLM_id int UNSIGNED NOT NULL,
    LLM_param_id INT UNSIGNED NOT NULL,
    prompt_template_id INT UNSIGNED NOT NULL,
    final_dataset_id INT UNSIGNED,
    CONSTRAINT PK_PromptConfig PRIMARY KEY (id),
    CONSTRAINT FK_experiment_id FOREIGN KEY (experiment_id) REFERENCES Experiment(id),
    CONSTRAINT FK_LLM_id FOREIGN KEY (LLM_id) REFERENCES Llm(id),
    CONSTRAINT FK_LLM_param_id FOREIGN KEY (LLM_param_id) REFERENCES Llm_param(id),
    CONSTRAINT FK_Prompt_template_id FOREIGN KEY (prompt_template_id) REFERENCES PromptTemplate(id),
    CONSTRAINT unique_experiment_llm_llm_param_prompt UNIQUE (experiment_id, LLM_id, LLM_param_id, prompt_template_id, final_dataset_id),
    CONSTRAINT FK_dataset_id FOREIGN KEY (final_dataset_id) REFERENCES Dataset(id)
);

CREATE TABLE config_base_dataset(
    config_id INT UNSIGNED NOT NULL,
    dataset_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Config_base_dataset PRIMARY KEY (config_id, dataset_id),
    CONSTRAINT FK_config_id_base_dataset FOREIGN KEY (config_id) REFERENCES PromptConfig(id),
    CONSTRAINT FK_dataset_id_base_dataset FOREIGN KEY (dataset_id) REFERENCES Dataset(id)
);

CREATE TABLE Data_Input(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    dataset_id INT UNSIGNED NOT NULL,
    oracle TEXT,
    CONSTRAINT PK_Input PRIMARY KEY (id),
    CONSTRAINT FK_dataset_id_input FOREIGN KEY (dataset_id) REFERENCES Dataset(id)
);

CREATE TABLE Input_marker(
    input_id INT UNSIGNED NOT NULL,
    marker_values_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Inputs_markers PRIMARY KEY (input_id, marker_values_id),
    CONSTRAINT FK_input_id FOREIGN KEY (input_id) REFERENCES Data_Input(id),
    CONSTRAINT FK_marker_id_input FOREIGN KEY (marker_values_id) REFERENCES Marker_value(id)
);

CREATE TABLE Result(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    config_id INT UNSIGNED NOT NULL,
    output_result TEXT NOT NULL,
    input_id INT UNSIGNED NOT NULL,
    start_time TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    end_time TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    total_tokens INT UNSIGNED,
    CONSTRAINT PK_Result PRIMARY KEY (id),
    CONSTRAINT FK_config_id FOREIGN KEY (config_id) REFERENCES PromptConfig(id),
    CONSTRAINT FK_input_id_result FOREIGN KEY (input_id) REFERENCES Data_Input(id)
);

CREATE TABLE Error(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    config_id INT UNSIGNED NOT NULL,
    input_id INT UNSIGNED NOT NULL,
    error_message TEXT NOT NULL,
    error_code INT UNSIGNED NOT NULL,
    start_time TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    end_time TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT PK_Error PRIMARY KEY (id),
    CONSTRAINT FK_config_id_error FOREIGN KEY (config_id) REFERENCES PromptConfig(id),
    CONSTRAINT FK_input_id_error FOREIGN KEY (input_id) REFERENCES Data_Input(id)
);

CREATE TABLE EvaluationsResult(
    evaluation_result TEXT NOT NULL,
    result_id INT UNSIGNED NOT NULL,
    evaluator_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Evaluation_Result PRIMARY KEY (result_id, evaluator_id),
    CONSTRAINT FK_result_id_eval FOREIGN KEY (result_id) REFERENCES Result(id),
    CONSTRAINT FK_evaluator_id FOREIGN KEY (evaluator_id) REFERENCES Evaluator(id)
);

CREATE TABLE Evaluator_config(
    config_id INT UNSIGNED NOT NULL,
    evaluator_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Evaluator_config PRIMARY KEY (config_id, evaluator_id),
    CONSTRAINT FK_config_id_eval_config FOREIGN KEY (config_id) REFERENCES PromptConfig(id),
    CONSTRAINT FK_evaluator_id_eval_config FOREIGN KEY (evaluator_id) REFERENCES Evaluator(id)
);

CREATE TABLE Template_dependency_progress(
    template_id INT UNSIGNED NOT NULL,
    last_result_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (template_id, last_result_id)
)
