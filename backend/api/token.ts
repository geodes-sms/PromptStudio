import {encoding_for_model, TiktokenModel} from "@dqbd/tiktoken";

/**
 * Calculates the number of tokens in a given text for a specified model.
 * @param model - The model to use for tokenization, e.g., 'gpt2', 'gpt-3.5-turbo', etc.
 * @param text - The text to tokenize.
 */
export function getTokenCount(model:string, text:string){
    try {
        const encoder = getEncoder(model);
        const tokens = encoder.encode(text);
        encoder.free();
        return tokens.length;
    } catch (error) {
        console.error("Error encoding text:", error);
        return 0;
    }
}

/**
 * Returns a Tiktoken encoder for the specified model.
 * If the model is not supported, it defaults to 'gpt2'.
 * @param model - The model to get the encoder for.
 */
function getEncoder(model: string){
    try{
        return encoding_for_model(model as TiktokenModel);
    }
    catch (error) {
        return getEncoder('gpt2');
    }
}