DROP DATABASE promptstudio;

CREATE DATABASE promptstudio;

USE promptstudio;

CREATE TABLE Experiment(
    id int UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL UNIQUE,
    datetime TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    total_requests INT UNSIGNED NOT NULL DEFAULT 0,
    max_retry INT UNSIGNED NOT NULL DEFAULT 0,
    threads INT UNSIGNED NOT NULL DEFAULT 1,
    CONSTRAINT PK_Experiment PRIMARY KEY (id),
    CHECK ( max_retry >= 0 )
);

CREATE INDEX idx_experiment_title ON Experiment(title);

CREATE TABLE Node(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    type ENUM('prompt_template', 'processor', 'evaluator', 'dataset') NOT NULL,
    experiment_id INT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    CONSTRAINT PK_node PRIMARY KEY (id),
    CONSTRAINT FK_experiment_id_node FOREIGN KEY (experiment_id) REFERENCES Experiment(id),
    CONSTRAINT unique_node_name UNIQUE (experiment_id, name)
);

CREATE TABLE Link(
    source_node_id INT UNSIGNED NOT NULL,
    target_node_id INT UNSIGNED NOT NULL,
    source_var VARCHAR(255),
    target_var VARCHAR(255),
    CONSTRAINT PK_Link PRIMARY KEY (source_node_id, target_node_id, target_var),
    CONSTRAINT FK_source_node_id FOREIGN KEY (source_node_id) REFERENCES Node(id),
    CONSTRAINT FK_target_node_id FOREIGN KEY (target_node_id) REFERENCES Node(id),
    CONSTRAINT CHK_same_node CHECK (source_node_id != target_node_id)
);

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

CREATE TABLE PromptTemplate(
    node_id INT UNSIGNED NOT NULL UNIQUE,
    value TEXT NOT NULL,
    name varchar(255) NOT NULL,
    iterations int NOT NULL DEFAULT 1,
    CONSTRAINT PK_Prompt_Template PRIMARY KEY (node_id),
    CONSTRAINT FK_node_id_prompt_template FOREIGN KEY (node_id) REFERENCES Node(id),
    CHECK ( iterations > 0 )
);

CREATE INDEX idx_prompt_template_name ON PromptTemplate(name);

CREATE TABLE Dataset(
    node_id INT UNSIGNED NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    CONSTRAINT PK_Dataset PRIMARY KEY (node_id),
    CONSTRAINT FK_node_id_dataset FOREIGN KEY (node_id) REFERENCES Node(id)
);

CREATE TABLE Marker(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    marker varchar(255) NOT NULL,
    dataset_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Marker PRIMARY KEY (id),
    CONSTRAINT FK_dataset_id_marker FOREIGN KEY (dataset_id) REFERENCES dataset(node_id)
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
    node_id INT UNSIGNED NOT NULL UNIQUE,
    type ENUM('simple', 'javascript', 'python') NOT NULL,
    code MEDIUMTEXT,
    name VARCHAR(255) NOT NULL,
    return_type ENUM('string', 'number', 'boolean') NOT NULL DEFAULT 'string',
    CONSTRAINT PK_Evaluator PRIMARY KEY (node_id),
    CONSTRAINT FK_node_id_evaluator FOREIGN KEY (node_id) REFERENCES Node(id)
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
    CONSTRAINT FK_Prompt_template_id FOREIGN KEY (prompt_template_id) REFERENCES PromptTemplate(node_id),
    CONSTRAINT unique_experiment_llm_llm_param_prompt UNIQUE (experiment_id, LLM_id, LLM_param_id, prompt_template_id, final_dataset_id),
    CONSTRAINT FK_dataset_id FOREIGN KEY (final_dataset_id) REFERENCES Dataset(node_id)
);

CREATE TABLE Data_Input(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    dataset_id INT UNSIGNED NOT NULL,
    oracle TEXT,
    CONSTRAINT PK_Input PRIMARY KEY (id),
    CONSTRAINT FK_dataset_id_input FOREIGN KEY (dataset_id) REFERENCES Dataset(node_id)
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
    start_time TIMESTAMP(6) NOT NULL,
    end_time TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT PK_Error PRIMARY KEY (id),
    CONSTRAINT FK_config_id_error FOREIGN KEY (config_id) REFERENCES PromptConfig(id),
    CONSTRAINT FK_input_id_error FOREIGN KEY (input_id) REFERENCES Data_Input(id)
);

CREATE TABLE Processor(
    node_id INT UNSIGNED NOT NULL UNIQUE,
    type ENUM('simple', 'javascript', 'python') NOT NULL,
    code MEDIUMTEXT,
    name VARCHAR(255) NOT NULL,
    CONSTRAINT PK_processor PRIMARY KEY (node_id),
    CONSTRAINT FK_node_id_processor FOREIGN KEY (node_id) REFERENCES Node(id)
);

CREATE TABLE Error_evaluator(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    evaluator_id INT UNSIGNED NOT NULL,
    error_message TEXT NOT NULL,
    result_id INT UNSIGNED,
    timestamp TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT PK_Error_evaluator PRIMARY KEY (id),
    CONSTRAINT FK_evaluator_id_error_eval FOREIGN KEY (evaluator_id) REFERENCES Evaluator(node_id),
    CONSTRAINT FK_result_id_error_eval FOREIGN KEY (result_id) REFERENCES Result(id)
);

CREATE TABLE EvaluationsResult(
    evaluation_result TEXT NOT NULL,
    result_id INT UNSIGNED,
    evaluator_id INT UNSIGNED NOT NULL,
    CONSTRAINT PK_Evaluation_Result PRIMARY KEY (result_id, evaluator_id),
    CONSTRAINT FK_result_id_eval FOREIGN KEY (result_id) REFERENCES Result(id),
    CONSTRAINT FK_evaluator_id FOREIGN KEY (evaluator_id) REFERENCES Evaluator(node_id)
);

CREATE TABLE ProcessorResult(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    processor_result TEXT NOT NULL,
    result_id INT UNSIGNED,
    processor_id INT UNSIGNED NOT NULL,
    input_id INT UNSIGNED,
    CONSTRAINT PK_Processor_Result PRIMARY KEY (id),
    CONSTRAINT Unique_Processor_Result UNIQUE (result_id, processor_id),
    CONSTRAINT Unique_Processor_Input UNIQUE (input_id, processor_id),
    CONSTRAINT FK_result_id_processor FOREIGN KEY (result_id) REFERENCES Result(id),
    CONSTRAINT FK_processor_id FOREIGN KEY (processor_id) REFERENCES Processor(node_id),
    CONSTRAINT FK_input_id_processor FOREIGN KEY (input_id) REFERENCES Data_Input(id),
    CONSTRAINT CHECK (result_id is NOT NULL OR input_id is NOT NULL)
);

CREATE TABLE Processor_error(
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    processor_id INT UNSIGNED NOT NULL,
    error_message TEXT NOT NULL,
    result_id INT UNSIGNED,
    input_id INT UNSIGNED,
    timestamp TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT PK_Processor_Error PRIMARY KEY (id),
    CONSTRAINT FK_processor_id_error FOREIGN KEY (processor_id) REFERENCES Processor(node_id),
    CONSTRAINT FK_result_id_processor_error FOREIGN KEY (result_id) REFERENCES Result(id),
    CONSTRAINT CHECK (result_id is NOT NULL OR input_id is NOT NULL)
);


CREATE VIEW View_Result_By_Template AS
SELECT
    r.*,
    pc.prompt_template_id
FROM result r
    JOIN promptconfig pc ON r.config_id = pc.id
    JOIN PromptTemplate pt ON pc.prompt_template_id = pt.node_id;


CREATE VIEW View_Input_Marker_Values AS
SELECT
    im.input_id,
    m.marker,
    mv.value
FROM Input_marker im
    JOIN Marker_value mv ON im.marker_values_id = mv.id
    JOIN Marker m ON mv.marker_id = m.id;

CREATE VIEW View_Nodes_Without_Parents AS
SELECT n.*
FROM Node n
WHERE NOT EXISTS (
    SELECT 1
    FROM Link l
             JOIN Node source ON l.source_node_id = source.id
    WHERE l.target_node_id = n.id
      AND source.experiment_id = n.experiment_id
);