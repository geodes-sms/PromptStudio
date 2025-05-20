Here is a dump of my head for the challenges a 3-year project should address. Modify at will!

# Trustworthy, Transparent, and Tenable Prompt Engineering (T3PE)

## 1. Cost-efficient scalable prompt optimization
### 1.1. Advanced prompt templates
*HQP: Vennila*
- Markers logic *(see PromptStudio doc)*
- Integrate into chains
- Prompt paraphrasing *(Kiruthika)*: parameters, intent
- Derive prompt variants 
- *ChainForge configuration mode to customize built-in prompts + LLMs to use for each interaction*

### 1.2. Headless mode of ChainForge
*HQP: Samuel, Parsa*
- Export a chain
- Setup an experiment
- Input dataset
- Run experiment on local, on-premise server (DIRO), remote cluster (Calcul QC)
- Collect experiment information and results: database, file export
- Real-time monitoring
- Integrate in ChainForge GUI

### 1.3. Search-space exploration
*HQP: Cassendre, Parsa*
- Multi-armed bandit cost-efficient optimization for search-space pruning
- Thompson sampling
- LLM-based search

## 2. Evaluation and reporting
### 2.1. Evaluation metrics for experiments
- Diversity of quantitative metrics
- Diversity of qualitative metrics
- LLM-based evaluation
- Quantitative and qualitative evaluation functions

### 2.2. Visualization of evaluation results
- Charts, Tables *(see PromptStudio doc)*
- Confidence interval
- Visualization of qualitative evaluation

### 2.3. Visualization of qualitative evaluation
- Trade-offs

### 2.4. Reporting methodology
*HQP: Karla*
- Reporting results
- Reporting the prompt engineering process

## 3. Continuous optimization
### 3.1. Continuous evolution
- LLM evolution
- Test set evolution
- Evaluator evolution

### 3.2. Prompt Linter
- Guidance on prompts
- Prompt pattern catalog

### 3.3. Integration in IDE
- VSCode plugin
