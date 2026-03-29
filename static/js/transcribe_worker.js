import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';

// Disable sending local model requests
env.allowLocalModels = false;
// Use all available WASM threads for CPU fallback
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

class PipelineFactory {
    static task = 'automatic-speech-recognition';
    // whisper-large-v3-turbo: distilled version of whisper-large-v3
    // ~4x better accuracy than base for Ukrainian/Russian/multilingual
    // Uses q4 quantization (~400MB download) for WebGPU compatibility
    static model = 'onnx-community/whisper-large-v3-turbo';
    static instance = null;
    static deviceUsed = 'wasm';

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            // Try WebGPU first for full GPU acceleration, fall back to WASM if unavailable
            const supportsWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
            const device = supportsWebGPU ? 'webgpu' : 'wasm';
            this.deviceUsed = device;

            console.log(`[Whisper] Initializing on device: ${device}`);

            // Large model: use q4 for both encoder and decoder on WebGPU to avoid VRAM limits.
            // On CPU fallback, q8 gives best accuracy-per-second tradeoff.
            const dtypeMap = supportsWebGPU
                ? { encoder_model: 'q4', decoder_model_merged: 'q4' }
                : { encoder_model: 'q8', decoder_model_merged: 'q8' };

            this.instance = await pipeline(this.task, this.model, {
                device,
                dtype: dtypeMap,
                progress_callback
            });
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const { type, data, msgId, language } = event.data;

    if (type === 'init') {
        try {
            self.postMessage({ type: 'status', status: 'loading' });
            
            await PipelineFactory.getInstance(x => {
                self.postMessage({ type: 'progress', data: x });
            });

            self.postMessage({ 
                type: 'status', 
                status: 'ready',
                device: PipelineFactory.deviceUsed
            });
        } catch (error) {
            console.error('[Whisper] Failed to initialize:', error);
            self.postMessage({ type: 'error', error: error.message || error.toString() });
        }

    } else if (type === 'transcribe') {
        try {
            const transcriber = await PipelineFactory.getInstance();

            // Build transcription options
            const transcribeOpts = {
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
            };

            // If user set a specific language, pass it (Whisper uses full names e.g. 'ukrainian', 'russian')
            // If null/empty, Whisper does its own auto-detection from audio
            if (language) {
                transcribeOpts.language = language;
            }

            const output = await transcriber(data, transcribeOpts);

            self.postMessage({ 
                type: 'transcription_result', 
                msgId,
                text: output.text 
            });

        } catch (error) {
            console.error('[Whisper] Transcription error:', error);
            self.postMessage({ 
                type: 'transcription_error', 
                msgId,
                error: error.message || error.toString() 
            });
        }
    }
});
