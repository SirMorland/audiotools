import { registerFlacEncoder } from "@mediabunny/flac-encoder";
import {
	ALL_FORMATS,
	AudioSample,
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

const speedFactor = 1.26;

/**
 * Copy audio sample data into an interleaved Float32Array.
 */
function readSample(sample: AudioSample): {
	data: Float32Array;
	isPlanar: boolean;
} {
	const isPlanar = sample.format.endsWith("-planar");
	const totalElements = sample.numberOfFrames * sample.numberOfChannels;
	const data = new Float32Array(totalElements);

	if (isPlanar) {
		const bytesPerSample = 4; // f32
		const planeByteSize = sample.numberOfFrames * bytesPerSample;
		const buffer = new ArrayBuffer(planeByteSize * sample.numberOfChannels);
		const view = new Uint8Array(buffer);

		// Read each planar channel
		for (let ch = 0; ch < sample.numberOfChannels; ch++) {
			sample.copyTo(view, {
				planeIndex: ch,
				format: "f32",
			});
			// Convert planar channel to interleaved
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

	return { data, isPlanar };
}

/**
 * Resample audio data using linear interpolation, with a speed factor.
 * Data is interleaved float32 (one sample per channel, then next frame).
 */
function resample(
	input: Float32Array,
	numberOfChannels: number,
	inputSampleRate: number,
	outputSampleRate: number,
	externalSpeedFactor: number,
): Float32Array {
	const duration = input.length / numberOfChannels / inputSampleRate;
	const outputFrameCount = Math.round(
		(duration / externalSpeedFactor) * outputSampleRate,
	);
	const output = new Float32Array(outputFrameCount * numberOfChannels);
	// For speedFactor > 1: each output frame maps further into the input,
	// so input is "squeezed" into a shorter duration.
	const frameRatio = (inputSampleRate * externalSpeedFactor) / outputSampleRate;
	const inputFrameCount = input.length / numberOfChannels;

	for (let outFrame = 0; outFrame < outputFrameCount; outFrame++) {
		const srcFloat = outFrame * frameRatio;
		const frameA = Math.min(Math.floor(srcFloat), inputFrameCount - 1);
		const frameB = Math.min(frameA + 1, inputFrameCount - 1);
		const t = srcFloat - Math.floor(srcFloat);

		for (let ch = 0; ch < numberOfChannels; ch++) {
			const idxA = frameA * numberOfChannels + ch;
			const idxB = frameB * numberOfChannels + ch;
			output[outFrame * numberOfChannels + ch] =
				(1 - t) * input[idxA] + t * input[idxB];
		}
	}

	return output;
}

/**
 * Process audio samples with a nightcore effect (1.25× speed, pitched up),
 * outputting at 44100 Hz sample rate.
 *
 * No built-in resampling is used — the effect is entirely handled in the
 * process callback. Timestamps are tracked across chunks so samples chain
 * seamlessly.
 */
function processNightcore(
	sample: AudioSample,
	outputFrameAccumulator: { frames: number },
): AudioSample | null {
	if (sample.numberOfFrames === 0) {
		return null;
	}

	const { data } = readSample(sample);
	const processed = resample(
		data,
		sample.numberOfChannels,
		sample.sampleRate,
		44100,
		speedFactor,
	);

	const outputFrameCount = processed.length / sample.numberOfChannels;
	const startTime = outputFrameAccumulator.frames / 44100;
	outputFrameAccumulator.frames += outputFrameCount;

	return new AudioSample({
		data: processed,
		format: "f32",
		numberOfChannels: sample.numberOfChannels,
		sampleRate: 44100,
		timestamp: startTime,
	});
}

/**
 * Process an audio buffer with a nightcore effect: sped up 1.25× and pitched up,
 * with the output sample rate fixed at 44100 Hz.
 *
 * Works in both browser and Node.js — no Web Audio API required.
 */
export async function nightcorefy(buffer: ArrayBuffer): Promise<ArrayBuffer> {
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BufferSource(buffer),
	});
	const metadata = await input.getMetadataTags();

	const output = new Output({
		format: new FlacOutputFormat(),
		target: new BufferTarget(),
	});

	const outputFrameAccumulator = { frames: 0 };

	const conversion = await Conversion.init({
		input,
		output,
		audio: {
			process: (sample) => processNightcore(sample, outputFrameAccumulator),
		},
	});

	if (!conversion.isValid) {
		const reasons = conversion.discardedTracks.map(
			(t) => `${t.track.type}: ${t.reason}`,
		);
		throw new Error(`Conversion failed: ${reasons.join(", ")}`);
	}

	output.setMetadataTags({
		title: metadata.title,
		albumArtist: "Nightcore",
		artist: `Nightcore; ${metadata.artist}`,
		album: metadata.album,
		images: metadata.images,
	});

	await conversion.execute();

	if (!output.target.buffer) {
		throw new Error("No output buffer produced");
	}

	return output.target.buffer;
}
