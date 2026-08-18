import { registerFlacEncoder } from "@mediabunny/flac-encoder";
import {
	ALL_FORMATS,
	AudioSample,
	AudioSampleSink,
	BufferSource,
	BufferTarget,
	Conversion,
	FlacOutputFormat,
	Input,
	Output,
	canEncodeAudio,
} from "mediabunny";

if (!(await canEncodeAudio("flac"))) {
	registerFlacEncoder();
}

/** Target loudness (dBFS relative to 0 dBFS). -10 matches typical streaming service loudness. */
const TARGET_LUFS = -10;

/**
 * Read an AudioSample into an interleaved Float32Array.
 * Supports both planar and interleaved formats.
 */
function readSample(sample: AudioSample): Float32Array {
	const isPlanar = sample.format.endsWith("-planar");
	const totalElements = sample.numberOfFrames * sample.numberOfChannels;
	const data = new Float32Array(totalElements);

	if (isPlanar) {
		const bytesPerSample = 4; // f32
		const planeByteSize = sample.numberOfFrames * bytesPerSample;
		const buffer = new ArrayBuffer(planeByteSize * sample.numberOfChannels);
		const view = new Uint8Array(buffer);

		for (let ch = 0; ch < sample.numberOfChannels; ch++) {
			sample.copyTo(view, {
				planeIndex: ch,
				format: "f32",
			});
			const channelView = new Float32Array(
				buffer,
				ch * planeByteSize,
				sample.numberOfFrames,
			);
			for (let frame = 0; frame < sample.numberOfFrames; frame++) {
				data[frame * sample.numberOfChannels + ch] = channelView[frame];
			}
		}
	} else {
		sample.copyTo(data, { planeIndex: 0, format: "f32" });
	}

	return data;
}

/**
 * Compute RMS of interleaved float32 audio data.
 */
function computeRMS(data: Float32Array): number {
	if (data.length === 0) return 0;
	let sumSq = 0;
	for (let i = 0; i < data.length; i++) {
		sumSq += data[i] * data[i];
	}
	return Math.sqrt(sumSq / data.length);
}

/**
 * Compute the loudness of audio data in dB relative to 0 dBFS.
 * dBFS = 10 * log10(rms^2) = 20 * log10(rms)
 */
function rmsToDbfs(rms: number): number {
	if (rms === 0 || rms <= Number.NEGATIVE_INFINITY) return -Infinity;
	return 20 * Math.log10(rms);
}

/**
 * Compute the gain factor needed to bring audio at the given loudness
 * (in dBFS) up to the target loudness (in LUFS).
 *
 * gain = 10^((target - current) / 20)
 * If current is quieter than target (e.g. -30 vs -16), gain > 1 (amplify).
 * If current is louder than target (e.g. -5 vs -16), gain < 1 (attenuate).
 */
function dbfsToGain(currentDbfs: number, targetDbfs: number): number {
	if (currentDbfs === -Infinity || currentDbfs === 0) return 1;
	return Math.pow(10, (targetDbfs - currentDbfs) / 20);
}

/**
 * Apply gain (linear multiplier) to interleaved float32 audio data.
 */
function applyGain(data: Float32Array, gain: number): Float32Array {
	const out = new Float32Array(data.length);
	for (let i = 0; i < data.length; i++) {
		out[i] = data[i] * gain;
	}
	return out;
}

/**
 * Re-encode an input track to FLAC without modification, preserving
 * all metadata.
 */
async function reencode(input: Input): Promise<ArrayBuffer> {
	const output = new Output({
		format: new FlacOutputFormat(),
		target: new BufferTarget(),
	});

	const conversion = await Conversion.init({ input, output });

	if (!conversion.isValid) {
		throw new Error("Conversion failed — unsupported track format");
	}

	const metadata = await input.getMetadataTags();
	output.setMetadataTags(metadata);

	await conversion.execute();

	if (!output.target.buffer) {
		throw new Error("No output buffer produced");
	}

	return output.target.buffer;
}

/**
 * Normalize a single track to the target loudness, applying a gain
 * factor. Metadata is preserved.
 *
 * Creates a fresh Input from the cached buffer to avoid issues with
 * the decoder position after analysis.
 */
export async function normalizeTrack(
	cachedBuffer: ArrayBuffer,
	gain: number,
): Promise<ArrayBuffer> {
	// Create a fresh Input from the cached buffer so the decoder
	// starts from the beginning (the original input may have been
	// consumed during analysis).
	const freshInput = new Input({
		formats: ALL_FORMATS,
		source: new BufferSource(cachedBuffer),
	});

	const output = new Output({
		format: new FlacOutputFormat(),
		target: new BufferTarget(),
	});

	if (gain === 1) {
		// No gain change needed — just re-encode as-is
		return reencode(freshInput);
	}

	const conversion = await Conversion.init({
		input: freshInput,
		output,
		audio: {
			process: (sample: AudioSample) => {
				const data = readSample(sample);
				sample.close();
				const processed = applyGain(data, gain);
				return new AudioSample({
					data: processed,
					format: "f32",
					numberOfChannels: sample.numberOfChannels,
					sampleRate: sample.sampleRate,
					timestamp: sample.timestamp,
				});
			},
		},
	});

	if (!conversion.isValid) {
		throw new Error("Conversion failed — unsupported track format");
	}

	// Preserve original metadata
	const metadata = await freshInput.getMetadataTags();
	output.setMetadataTags(metadata);

	await conversion.execute();

	if (!output.target.buffer) {
		throw new Error("No output buffer produced");
	}

	return output.target.buffer;
}

/**
 * Result of loudness analysis for a single track.
 */
interface TrackLoudness {
	rms: number;
	loudnessDbfs: number;
}

/**
 * Analyze the loudness of one or more audio tracks.
 *
 * Returns both per-track loudness info and the unified gain factor
 * needed to bring the combined signal to the target loudness.
 *
 * For album normalization, all tracks are treated as one continuous
 * signal so the gain adjustment is consistent across the entire album.
 *
 * @param inputs - One or more MediaBunny Input instances (one per track)
 * @returns Loudness info per track and the overall gain factor (1 = no change needed)
 */
export async function analyzeLoudness(
	inputs: Input[],
): Promise<{
	perTrack: TrackLoudness[];
	gain: number;
	combinedDbfs: number;
}> {
	if (inputs.length === 0) {
		return { perTrack: [], gain: 1, combinedDbfs: -Infinity };
	}

	// Compute per-track loudness using duration-weighted RMS
	const perTrack: TrackLoudness[] = [];
	let totalEnergy = 0; // sum of (rms^2 * duration) across all tracks
	let totalDuration = 0;

	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];

		// Collect samples from this track
		const allSamples: Float32Array[] = [];

		const audioTracks = await input.getAudioTracks();
		if (audioTracks.length === 0) {
			// No audio track — treat as silence
			perTrack.push({ rms: 0, loudnessDbfs: -Infinity });
			continue;
		}

		const audioTrack = audioTracks[0];
		const sink = new AudioSampleSink(audioTrack);
		const numChannels = await audioTrack.getNumberOfChannels();
		const sampleRate = await input.getAudioTracks().then((t) => t[0]?.getSampleRate?.() ?? 44100);

		for await (const sample of sink.samples()) {
			const data = readSample(sample);
			allSamples.push(data);
			sample.close();
		}

		if (allSamples.length === 0) {
			perTrack.push({ rms: 0, loudnessDbfs: -Infinity });
			continue;
		}

		// Combine all samples and compute RMS
		const totalLength = allSamples.reduce((sum, s) => sum + s.length, 0);
		const combined = new Float32Array(totalLength);
		let offset = 0;
		for (const s of allSamples) {
			combined.set(s, offset);
			offset += s.length;
		}

		const trackRms = computeRMS(combined);
		const trackDbfs = rmsToDbfs(trackRms);
		perTrack.push({ rms: trackRms, loudnessDbfs: trackDbfs });

		// Accumulate energy for combined calculation
		const trackDuration = totalLength / numChannels / sampleRate;
		totalEnergy += trackRms * trackRms * trackDuration;
		totalDuration += trackDuration;
	}

	// Compute combined loudness
	const combinedRms =
		totalDuration > 0 ? Math.sqrt(totalEnergy / totalDuration) : 0;
	const combinedDbfs = rmsToDbfs(combinedRms);

	// Compute gain to reach target
	const gain = combinedRms === 0 ? 1 : dbfsToGain(combinedDbfs, TARGET_LUFS);

	return { perTrack, gain, combinedDbfs };
}

/**
 * Normalize one or more tracks as a single album.
 *
 * All tracks are analyzed together to compute a unified gain factor,
 * then each track is re-encoded with that gain applied.
 * Original metadata (title, artist, album, track number, etc.) is preserved.
 *
 * @param inputs - One or more MediaBunny Input instances (one per track)
 * @param buffers - Cached ArrayBuffer for each track (used for normalization since inputs are consumed during analysis)
 * @param onProgress - Called with (index, total) after each track completes
 * @returns Array of normalized FLAC buffers, one per input track
 */
export async function normalizeAlbum(
	inputs: Input[],
	buffers: ArrayBuffer[],
	onProgress?: (index: number, total: number) => void,
): Promise<ArrayBuffer[]> {
	if (inputs.length === 0) return [];

	const { gain } = await analyzeLoudness(inputs);
	const results: ArrayBuffer[] = [];

	for (let i = 0; i < inputs.length; i++) {
		const buffer = await normalizeTrack(buffers[i], gain);
		results.push(buffer);
		onProgress?.(i + 1, inputs.length);
	}

	return results;
}
