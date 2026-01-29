/**
 * Audio Processing Service
 * 
 * Provides audio quality enhancement for voice recordings.
 * All processing is done in the browser using Web Audio API.
 * 
 * Features:
 * - Optimized getUserMedia constraints for high-quality recording
 * - Noise reduction filter
 * - Volume normalization
 * - Audio compression
 */

/**
 * Optimized audio constraints for high-quality voice recording
 * These settings prioritize voice clarity over compression
 */
export const getOptimizedAudioConstraints = (): MediaTrackConstraints => {
    return {
        // Echo cancellation helps in environments with speakers
        echoCancellation: true,
        // Noise suppression is useful but can sometimes muffle voice
        noiseSuppression: true,
        // Disable auto gain control for more consistent volume
        autoGainControl: false,
        // Higher sample rate for better quality
        sampleRate: 48000,
        // Mono is sufficient for voice and reduces file size
        channelCount: 1,
    };
};

/**
 * Alternative high-fidelity constraints (when quality is most important)
 * Use this when recording in a quiet environment
 */
export const getHighFidelityAudioConstraints = (): MediaTrackConstraints => {
    return {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: 1,
    };
};

/**
 * Audio Processing Node Chain
 * Creates a chain of audio processing nodes for real-time enhancement
 */
export interface AudioProcessingChain {
    source: MediaStreamAudioSourceNode;
    destination: MediaStreamAudioDestinationNode;
    gainNode: GainNode;
    compressor: DynamicsCompressorNode;
    lowPassFilter: BiquadFilterNode;
    highPassFilter: BiquadFilterNode;
}

export const createAudioProcessingChain = (
    audioContext: AudioContext,
    sourceStream: MediaStream
): AudioProcessingChain => {
    // Create source from input stream
    const source = audioContext.createMediaStreamSource(sourceStream);

    // Create destination for processed output
    const destination = audioContext.createMediaStreamDestination();

    // Gain node for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.2; // Slight boost

    // High-pass filter to remove low frequency rumble
    const highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 80; // Cut below 80Hz
    highPassFilter.Q.value = 0.7;

    // Low-pass filter to remove high frequency noise
    const lowPassFilter = audioContext.createBiquadFilter();
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = 12000; // Cut above 12kHz
    lowPassFilter.Q.value = 0.7;

    // Compressor for consistent volume levels
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24; // Start compressing at -24dB
    compressor.knee.value = 12; // Soft knee for natural sound
    compressor.ratio.value = 4; // 4:1 compression ratio
    compressor.attack.value = 0.003; // 3ms attack
    compressor.release.value = 0.25; // 250ms release

    // Connect the chain
    source
        .connect(highPassFilter)
        .connect(lowPassFilter)
        .connect(gainNode)
        .connect(compressor)
        .connect(destination);

    return {
        source,
        destination,
        gainNode,
        compressor,
        lowPassFilter,
        highPassFilter,
    };
};

/**
 * Get processed audio stream with quality enhancements
 * Returns a new MediaStream with processed audio
 */
export const getProcessedAudioStream = async (
    useHighFidelity: boolean = false
): Promise<{
    stream: MediaStream;
    chain: AudioProcessingChain;
    audioContext: AudioContext;
    cleanup: () => void;
}> => {
    const constraints = useHighFidelity
        ? getHighFidelityAudioConstraints()
        : getOptimizedAudioConstraints();

    // Get raw audio stream
    const rawStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });

    // Create audio context
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextClass({ sampleRate: 48000 });

    // Create processing chain
    const chain = createAudioProcessingChain(audioContext, rawStream);

    // Cleanup function
    const cleanup = () => {
        rawStream.getTracks().forEach(track => track.stop());
        chain.source.disconnect();
        chain.highPassFilter.disconnect();
        chain.lowPassFilter.disconnect();
        chain.gainNode.disconnect();
        chain.compressor.disconnect();
        audioContext.close().catch(() => { });
    };

    return {
        stream: chain.destination.stream,
        chain,
        audioContext,
        cleanup,
    };
};

/**
 * Normalize audio buffer to consistent volume level
 */
export const normalizeAudioBuffer = (
    audioContext: AudioContext,
    buffer: AudioBuffer,
    targetLevel: number = 0.9
): AudioBuffer => {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    // Create new buffer for normalized audio
    const normalizedBuffer = audioContext.createBuffer(numChannels, length, sampleRate);

    // Find peak level across all channels
    let peak = 0;
    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            const absValue = Math.abs(channelData[i]);
            if (absValue > peak) {
                peak = absValue;
            }
        }
    }

    // Calculate normalization factor
    const factor = peak > 0 ? targetLevel / peak : 1;

    // Apply normalization
    for (let channel = 0; channel < numChannels; channel++) {
        const sourceData = buffer.getChannelData(channel);
        const targetData = normalizedBuffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            targetData[i] = sourceData[i] * factor;
        }
    }

    return normalizedBuffer;
};

/**
 * Audio quality settings interface
 */
export interface AudioQualitySettings {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    useProcessingChain: boolean;
    normalizationLevel: number;
}

/**
 * Default audio quality settings
 */
export const defaultAudioSettings: AudioQualitySettings = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    useProcessingChain: true,
    normalizationLevel: 0.9,
};

/**
 * Save audio settings to localStorage
 */
export const saveAudioSettings = (settings: AudioQualitySettings): void => {
    try {
        localStorage.setItem('musegacha_audio_settings', JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save audio settings:', e);
    }
};

/**
 * Load audio settings from localStorage
 */
export const loadAudioSettings = (): AudioQualitySettings => {
    try {
        const stored = localStorage.getItem('musegacha_audio_settings');
        if (stored) {
            return { ...defaultAudioSettings, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.warn('Failed to load audio settings:', e);
    }
    return defaultAudioSettings;
};

export default {
    getOptimizedAudioConstraints,
    getHighFidelityAudioConstraints,
    createAudioProcessingChain,
    getProcessedAudioStream,
    normalizeAudioBuffer,
    saveAudioSettings,
    loadAudioSettings,
    defaultAudioSettings,
};
