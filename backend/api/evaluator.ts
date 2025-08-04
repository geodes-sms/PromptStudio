import {Dict, PromptVarsDict} from "../typing";
import {ResponseInfo} from "../backend";
import * as vm from "node:vm";
import {Result} from "./types";
import {cleanEscapedBraces} from "../template";

type EvalOrProcessResult = { result_id: number; result?: any; error?: any };
type EvalOrProcessResponse = {
    response?: EvalOrProcessResult;
    logs?: string[];
    error?: string;
}

/**
 * Executes JavaScript code in a sandboxed environment.
 * The code should define a function named `evaluate` or `process` depending on the process
 * @param code - JavaScript code as a string or a function that takes a ResponseInfo object and returns a value.
 * @param result - The result object containing the output result and ID.
 * @param vars - A dictionary of prompt variables.
 * @param metavars - A dictionary of metadata variables.
 * @param llm_name - The name of the LLM used for processing.
 * @param prompt - The prompt string used in the evaluation or processing.
 * @param process_type - The type of process to execute, either "evaluator" or "processor".
 */
export async function executejs(
    code: string | ((rinfo: ResponseInfo) => any),
    result: Result,
    vars: PromptVarsDict,
    metavars: Dict,
    llm_name: string,
    prompt: string,
    process_type: "evaluator" | "processor",
): Promise<EvalOrProcessResponse> {
    const req_func_name = process_type === "evaluator" ? "evaluate" : "process";

    let process_func: (rinfo: ResponseInfo) => any;
    let all_logs: string[] = [];

    if (typeof code === "string") {
        try {
            const logBuffer: string[] = [];
            const sandbox = {
                console: {
                    log: (...args: any[]) => logBuffer.push(args.join(" ")),
                    warn: (...args: any[]) => logBuffer.push(args.join(" ")),
                    error: (...args: any[]) => logBuffer.push(args.join(" ")),
                },
            };

            const context = vm.createContext(sandbox);
            vm.runInContext(code, context);

            process_func = context[req_func_name];
            if (typeof process_func !== "function") {
                return {
                    error: `${req_func_name}() is not defined in the provided code.`,
                };
            }

            all_logs = logBuffer;
        } catch (err) {
            return {
                error: `Could not compile code. Error message:\n${(err as Error).message}`,
            };
        }
    } else {
        process_func = code;
    }

    try {
        const response = await run_over_response(
            process_func,
            result,
            vars,
            metavars,
            llm_name,
            prompt,
            process_type,
        );

        return { response, logs: all_logs };
    } catch (err) {
        return {
            error: `Error encountered while trying to run "${req_func_name}" method:\n${(err as Error).message}`,
            logs: all_logs,
        };
    }
}


/**
 * Runs the provided process function over the response information.
 * @param process_func - A function that takes a ResponseInfo object and returns a processed result.
 * @param result - The result object containing the output result and ID.
 * @param vars - A dictionary of prompt variables.
 * @param metavars - A dictionary of metadata variables.
 * @param llm_name - The name of the LLM used for processing.
 * @param prompt - The prompt string used in the evaluation or processing.
 * @param process_type - The type of process to execute, either "evaluator" or "processor".
 */
export async function run_over_response(
    process_func: (resp: ResponseInfo) => any,
    result: Result,
    vars: PromptVarsDict,
    metavars: Dict,
    llm_name: string,
    prompt: string,
    process_type: "evaluator" | "processor",
): Promise<
    { result_id: number; result?: any; error?: string }
> {
        const r_info = new ResponseInfo(
            cleanEscapedBraces(result.output_result),
            prompt,
            vars,
            metavars || {},
            llm_name
        );

        try {
            let processed = process_func(r_info);
            if (processed && typeof processed.then === "function") {
                processed = await processed;
            }

            return { result_id: result.id, result: processed }
        } catch (err) {
            return {
                result_id: result.id,
                error: (err as Error).message,
            };
        }
}