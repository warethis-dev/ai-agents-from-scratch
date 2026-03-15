import {LlamaText} from "node-llama-cpp";
import path from "path";
import fs from "fs/promises";

/**
 * Output types for debugging
 */
const OutputTypes = {
    EXACT_PROMPT: 'exactPrompt',
    CONTEXT_STATE: 'contextState',
    STRUCTURED: 'structured'
};

/**
 * Helper class for debugging and logging LLM prompts
 */
export class PromptDebugger {
    constructor(options = {}) {
        this.outputDir = options.outputDir || './';
        this.filename = options.filename;
        this.includeTimestamp = options.includeTimestamp ?? false;
        this.appendMode = options.appendMode ?? false;
        // Configure which outputs to include
        this.outputTypes = options.outputTypes || [OutputTypes.EXACT_PROMPT];
        // Ensure outputTypes is always an array
        if (!Array.isArray(this.outputTypes)) {
            this.outputTypes = [this.outputTypes];
        }
    }

    /**
     * Captures only the exact prompt (user input + system + functions)
     * @param {Object} params
     * @param {Object} params.session - The chat session
     * @param {string} params.prompt - The user prompt
     * @param {string} params.systemPrompt - System prompt (optional)
     * @param {Object} params.functions - Available functions (optional)
     * @returns {Object} The exact prompt data
     */
    captureExactPrompt(params) {
        const { session, prompt, systemPrompt, functions } = params;

        const chatWrapper = session.chatWrapper;

        // Build minimal history for exact prompt
        const history = [{ type: 'user', text: prompt }];

        if (systemPrompt) {
            history.unshift({ type: 'system', text: systemPrompt });
        }

        // Generate the context state with just the current prompt
        const state = chatWrapper.generateContextState({
            chatHistory: history,
            availableFunctions: functions,
            systemPrompt: systemPrompt
        });

        const formattedPrompt = state.contextText.toString();

        return {
            exactPrompt: formattedPrompt,
            timestamp: new Date().toISOString(),
            prompt,
            systemPrompt,
            functions: functions ? Object.keys(functions) : []
        };
    }

    /**
     * Captures the full context state (includes assistant responses)
     * @param {Object} params
     * @param {Object} params.session - The chat session
     * @param {Object} params.model - The loaded model
     * @returns {Object} The context state data
     */
    captureContextState(params) {
        const { session, model } = params;

        // Get the actual context from the session after responses
        const contextState = model.detokenize(session.sequence.contextTokens, true);

        return {
            contextState,
            timestamp: new Date().toISOString(),
            tokenCount: session.sequence.contextTokens.length
        };
    }

    /**
     * Captures the structured token representation
     * @param {Object} params
     * @param {Object} params.session - The chat session
     * @param {Object} params.model - The loaded model
     * @returns {Object} The structured token data
     */
    captureStructured(params) {
        const { session, model } = params;

        const structured = LlamaText.fromTokens(model.tokenizer, session.sequence.contextTokens);

        return {
            structured,
            timestamp: new Date().toISOString(),
            tokenCount: session.sequence.contextTokens.length
        };
    }

    /**
     * Captures all configured output types
     * @param {Object} params - Contains all possible parameters
     * @returns {Object} Combined captured data based on configuration
     */
    captureAll(params) {
        const result = {
            timestamp: new Date().toISOString()
        };

        if (this.outputTypes.includes(OutputTypes.EXACT_PROMPT)) {
            const exactData = this.captureExactPrompt(params);
            result.exactPrompt = exactData.exactPrompt;
            result.prompt = exactData.prompt;
            result.systemPrompt = exactData.systemPrompt;
            result.functions = exactData.functions;
        }

        if (this.outputTypes.includes(OutputTypes.CONTEXT_STATE)) {
            const contextData = this.captureContextState(params);
            result.contextState = contextData.contextState;
            result.contextTokenCount = contextData.tokenCount;
        }

        if (this.outputTypes.includes(OutputTypes.STRUCTURED)) {
            const structuredData = this.captureStructured(params);
            result.structured = structuredData.structured;
            result.structuredTokenCount = structuredData.tokenCount;
        }

        return result;
    }

    /**
     * Formats the captured data based on configuration
     * @param {Object} capturedData - Data from capture methods
     * @returns {string} Formatted output
     */
    formatOutput(capturedData) {
        let output = `\n========== PROMPT DEBUG OUTPUT ==========\n`;
        output += `Timestamp: ${capturedData.timestamp}\n`;

        if (capturedData.prompt) {
            output += `Original Prompt: ${capturedData.prompt}\n`;
        }

        if (capturedData.systemPrompt) {
            output += `System Prompt: ${capturedData.systemPrompt.substring(0, 50)}...\n`;
        }

        if (capturedData.functions && capturedData.functions.length > 0) {
            output += `Functions: ${capturedData.functions.join(', ')}\n`;
        }

        if (capturedData.exactPrompt) {
            output += `\n=== EXACT PROMPT ===\n`;
            output += capturedData.exactPrompt;
            output += `\n`;
        }

        if (capturedData.contextState) {
            output += `Token Count: ${capturedData.contextTokenCount || 'N/A'}\n`;

            output += `\n=== CONTEXT STATE ===\n`;
            output += capturedData.contextState;
            output += `\n`;
        }

        if (capturedData.structured) {
            output += `\n=== STRUCTURED ===\n`;
            output += `Token Count: ${capturedData.structuredTokenCount || 'N/A'}\n`;
            output += JSON.stringify(capturedData.structured, null, 2);
            output += `\n`;
        }

        output += `==========================================\n`;
        return output;
    }

    /**
     * Saves data to file
     * @param {Object} capturedData - Data to save
     * @param {null} customFilename - Optional custom filename
     */
    async saveToFile(capturedData, customFilename = null) {
        const content = this.formatOutput(capturedData);

        let filename = customFilename || this.filename;

        if (this.includeTimestamp) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);
            filename = `${base}_${timestamp}${ext}`;
        }

        const filepath = path.join(this.outputDir, filename);

        // Ensure output directory exists (prevents ENOENT when writing logs)
        await fs.mkdir(path.dirname(filepath), { recursive: true });

        if (this.appendMode) {
            await fs.appendFile(filepath, content, 'utf8');
        } else {
            await fs.writeFile(filepath, content, 'utf8');
        }

        console.log(`Prompt debug output written to ${filepath}`);
        return filepath;
    }

    /**
     * Debug exact prompt only - minimal params needed
     * @param {Object} params - session, prompt, systemPrompt (optional), functions (optional)
     * @param customFilename
     */
    async debugExactPrompt(params, customFilename = null) {
        const oldOutputTypes = this.outputTypes;
        this.outputTypes = [OutputTypes.EXACT_PROMPT];
        const capturedData = this.captureAll(params);
        const filepath = await this.saveToFile(capturedData, customFilename);
        this.outputTypes = oldOutputTypes;
        return { capturedData, filepath };
    }

    /**
     * Debug context state only - needs session and model
     * @param {Object} params - session, model
     * @param customFilename
     */
    async debugContextState(params, customFilename = null) {
        const oldOutputTypes = this.outputTypes;
        this.outputTypes = [OutputTypes.CONTEXT_STATE];
        const capturedData = this.captureAll(params);
        const filepath = await this.saveToFile(capturedData, customFilename);
        this.outputTypes = oldOutputTypes;
        return { capturedData, filepath };
    }

    /**
     * Debug structured only - needs session and model
     * @param {Object} params - session, model
     * @param customFilename
     */
    async debugStructured(params, customFilename = null) {
        const oldOutputTypes = this.outputTypes;
        this.outputTypes = [OutputTypes.STRUCTURED];
        const capturedData = this.captureAll(params);
        const filepath = await this.saveToFile(capturedData, customFilename);
        this.outputTypes = oldOutputTypes;
        return { capturedData, filepath };
    }

    /**
     * Debug with configured output types
     * @param {Object} params - All parameters (session, model, prompt, etc.)
     * @param customFilename
     */
    async debug(params, customFilename = null) {
        const capturedData = this.captureAll(params);
        //const filepath = await this.saveToFile(capturedData, customFilename);
        return { capturedData };
    }

    /**
     * Log to console only
     * @param {Object} params - Parameters based on configured output types
     */
    logToConsole(params) {
        const capturedData = this.captureAll(params);
        console.log(this.formatOutput(capturedData));
        return capturedData;
    }

    /**
     * Log exact prompt to console
     */
    logExactPrompt(params) {
        const capturedData = this.captureExactPrompt(params);
        console.log(this.formatOutput(capturedData));
        return capturedData;
    }

    /**
     * Log context state to console
     */
    logContextState(params) {
        const capturedData = this.captureContextState(params);
        console.log(this.formatOutput(capturedData));
        return capturedData;
    }

    /**
     * Log structured to console
     */
    logStructured(params) {
        const capturedData = this.captureStructured(params);
        console.log(this.formatOutput(capturedData));
        return capturedData;
    }
}

/**
 * Quick function to debug exact prompt only
 */
async function debugExactPrompt(params, options = {}) {
    const promptDebugger = new PromptDebugger({
        ...options,
        outputTypes: [OutputTypes.EXACT_PROMPT]
    });
    return await promptDebugger.debug(params);
}

/**
 * Quick function to debug context state only
 */
async function debugContextState(params, options = {}) {
    const promptDebugger = new PromptDebugger({
        ...options,
        outputTypes: [OutputTypes.CONTEXT_STATE]
    });
    return await promptDebugger.debug(params);
}

/**
 * Quick function to debug structured only
 */
async function debugStructured(params, options = {}) {
    const promptDebugger = new PromptDebugger({
        ...options,
        outputTypes: [OutputTypes.STRUCTURED]
    });
    return await promptDebugger.debug(params);
}

/**
 * Quick function to debug all outputs
 */
async function debugAll(params, options = {}) {
    const promptDebugger = new PromptDebugger({
        ...options,
        outputTypes: [OutputTypes.EXACT_PROMPT, OutputTypes.CONTEXT_STATE, OutputTypes.STRUCTURED]
    });
    return await promptDebugger.debug(params);
}