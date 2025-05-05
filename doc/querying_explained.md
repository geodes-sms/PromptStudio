# Querying in ChainForge

Note: This document covers the technical side of querying LLMs in [ChainForge](https://github.com/ianarawjo/ChainForge), as well as a description of the dream of `yaml`-driven flow files in ChainForge, which could be run entirely "headless": from the command line or an API.

## Try it out and read the docs

ChainForge has [extensive docs](chainforge.ai/docs), I suggest first using Example Flows and playing around with the tool to do interesting things, alongside reading the documentation, before proceeding to reading the below technical details. There are also many videos I have made introducing the tool, which are available on YouTube. [A student has collected these resources here.](https://github.com/loloMD/awesome_chainforge)

## Technical description of ChainForge backend as it pertains to querying 

ChainForge has two "backends":
 - The TypeScript backend in the `backend` folder, composed of `.ts` files. The TypeScript backend is the main place for all browser-side logic in ChainForge, especially querying and evaluation logic. Historical note: this used to be the Flask backend (written in Python), and was rewritten entirely in TypeScript so that ChainForge could be hosted entirely client-side (on the user's browser). 
 - The Flask backend in Python, for anything that *must* be done on the local machine when running ChainForge locally. For instance, saving files goes through the Flask backend, since browsers do not allow write access to the local disk. Running Python evaluators is also done in the Flask backend. You will find several places in ChainForge that check if the Flask backend is available by checking a global `IS_RUNNING_LOCALLY` flag; for instance, autosaving will defer to the browser if Flask is not available, which is suboptimal.

ChainForge is unlike other querying-LLM tools because it is built from the ground-up to query _multiple LLMs_ at once with many parametrized prompts and pass metadata downstream (from query into the responses). All querying is done _asynchronously_ and much of it uses _generators_ for optimal performance. The querying aspect of ChainForge is by far the most battle-tested of the entire repository.

The querying part of ChainForge goes through:
 - `backend.ts`, for a long list of util functions. (This used to be the old Flask backend.)
 - The function `queryLLM` in `backend.ts` is the main entry point for querying LLMs with the specified parameters. There are many arguments to this function, which include passing variables (`vars` dicts), multiple LLMs (`LLMSpec`s), multiple chat histories, etc. 
 - `query.ts` is the logic that all LLM queries are funneled through, and manages generating prompts and rate-limiting the individual LLM calls. 
 - `utils.ts` contains all LLM-specific calling functions, aside from helpful util functions used throughout ChainForge. For example, `call_chatgpt` and `call_anthropic` are in `utils.ts`. If a new LLM provider is added (e.g., Cohere), the function to send an _individual_ query to the LLM provider should be placed in `utils.ts`. The `call_llm` function serves as a router: it tries to determine what provider based on a model name, and hence what specific LLM-querying function it should call. 
 - `models.ts` contains a long list of all model names accepted in ChainForge and their providers (`LLMProvider`) as an enum. The rate limiting parameters are set here, using the `bottleneck` library. (We currently hardcode the rate limits, this is something you might want to give users control over changing in the future). 

The querying in `queryLLM` is powerful because it:
 - caches (saves) each response the moment it receives it
 - only sends the queries it hasn't gotten a response to yet (looks up the given prompts/params/LLMs in a cache, and if there's already a response for those parameters, returns the already-received response) 
 - uses complex Promises to "yield Promises as completed" in a for loop (which is not default behavior in JavaScript)
 - beams real-time progress back up to the caller, even from within several nested asynchronous functions
 - allows for "canceling" queries that are yet to be sent off (what happens if you press "Stop" on a running Prompt Node)

Prompts are generated from prompt templates in `template.ts`, which uses generator functions and a recursive template-filling algorithm. This is powerful but may be hard to understand on first glance. I suggest you do not touch this file unless you are sure of what you are doing. 

## A possible starting point to a headless mode

Perhaps the starting point for moving to a completely server-side running of queries is to create
a separate server (`Node.js`?) that only runs the TypeScript backend of ChainForge. You would then:
 - write a main entry point to your backend server, i.e., a command-line interface where users could enter options
 - this main entry point would handle calling `queryLLM` in `backend.ts`, passing in parameters ideally through a `YAML` file the user has defined elsewhere.
 - you would stream the progress back and collect the responses
 - as the responses come in, you would save them to a local SQL database (the moment they arrive)

Although Python is well-liked in this space, Python is a mess because it has weak typing support and this hinders collaboration. 
TypeScript is much better in this regard. Although it is a little more complicated, I highly recommend sticking to TypeScript here.

# The current LLMOps landscape and the argument for "headless" mode in ChainForge

As it stands, ChainForge is great for rapidly prototyping prompts and chains,
but when users want to transition to more production-ready environments (exporting their prompts or evals),
they can struggle. 

What is emerging as standard in LLMOps are `yaml` files for describing flows and experiments.
I strongly recommend that you opt for a similar approach to defining flows (experiments) via text files.
These YAML files should as much as possible be simplified versions of the `.cforge` (JSON) files that are currently exported by ChainForge,
for maximum interoperability and to reduce redundancy. Flow files are best understood by loading the Example Flows in `examples` in a text editor and looking at the structure. To understand what could be saved on each node, see the `data` parameter of Nodes in the node classes (`.tsx` files). To understand the internal name (string) given to each node (the `type` parameter of the node's saved data, which must be consistent), see `App.tsx` near the top. 

The ultimate goal is for ChainForge flows to be one-to-one with a YAML description that users
could choose to enter entirely in YAML, should they wish, and which they could run
entirely "headless" (from the command line or an API). There are many long-term benefits to this approach:
 - it allows for easier `git` commits to software repositories. 
 - experiments on prompts (evals) could be setup for continuous integration
 - experiments that take a long time can be run without the need to have the browser open (i.e., overnight)
 - it would help users extract prompts in a structured manner (e.g., one could imagine a larger application has a ChainForge flow as `yaml` 
stored inside it where all evaluations are done, but a specific prompt within this `yaml` is flagged and imported
inside the production-ready code.)
 - deterministic (i.e., non-branching-paths) ChainForge flows could become apps/scripts
