import {encoding_for_model} from "@dqbd/tiktoken";

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

function getEncoder(model: string){
    try{
        return encoding_for_model(model);
    }
    catch (error) {
        return getEncoder('gpt2');
    }
}