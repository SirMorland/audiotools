import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { useCallback, useState } from "react";

import { analyzeLoudness, normalizeAlbum } from "../../lib/normalize";
import FilePicker, { type FileResult } from "./FilePicker";
import ResultsList from "./ResultsList";

function NormalizeTab() {
	const [analyzing, setAnalyzing] = useState(false);
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState<string>();
	const [stats, setStats] = useState<string>();
	const [results, setResults] = useState<FileResult[]>([]);

	const reset = useCallback(() => {
		for (const r of results) {
			URL.revokeObjectURL(r.url);
		}
		setResults([]);
		setProgress(undefined);
		setStats(undefined);
	}, [results]);

	const processAudioFiles = async (files: File[]) => {
		if (files.length === 0) {
			setProgress("No audio files found.");
			return;
		}

		reset();
		setAnalyzing(true);

		try {
			const buffers: ArrayBuffer[] = [];
			const inputs: Input[] = [];

			for (const file of files) {
				const buffer = await file.arrayBuffer();
				buffers.push(buffer);
				const input = new Input({
					formats: ALL_FORMATS,
					source: new BufferSource(buffer),
				});
				inputs.push(input);
			}

			const { perTrack, gain, combinedDbfs } = await analyzeLoudness(inputs);

			const minDb = Math.min(...perTrack.map((t) => t.loudnessDbfs));
			const maxDb = Math.max(...perTrack.map((t) => t.loudnessDbfs));

			if (gain === 1) {
				setStats(
					"Already at or above target loudness (-10 LUFS). No changes needed.",
				);
				return;
			}

			const statsMsg =
				gain < 1
					? `Album loudness: ${combinedDbfs.toFixed(1)} dBFS → target -10 dBFS (${gain.toFixed(2)}× attenuation)`
					: `Album loudness: ${combinedDbfs.toFixed(1)} dBFS (quietest: ${minDb.toFixed(1)}, loudest: ${maxDb.toFixed(1)}) → target -10 dBFS (${gain.toFixed(2)}×)`;

			setStats(statsMsg);

			setAnalyzing(false);
			setProcessing(true);

			const normalizedBuffers = await normalizeAlbum(
				inputs,
				buffers,
				(done, total) => {
					setProgress(`Processing ${done}/${total}: ${files[done - 1].name}`);
				},
			);

			const trackResults: FileResult[] = [];
			for (let i = 0; i < files.length; i++) {
				const name = files[i].name.replace(/\.[^.]+$/, "") + ".flac";
				const url = URL.createObjectURL(
					new Blob([normalizedBuffers[i]], { type: "audio/flac" }),
				);
				trackResults.push({ name, buffer: normalizedBuffers[i], url });
			}

			setProcessing(false);
			setProgress(undefined);
			setResults(trackResults);
		} catch (err) {
			setAnalyzing(false);
			setProcessing(false);
			setProgress(`Error: ${(err as Error).message}`);
		}
	};

	return (
		<section>
			<h2>Normalize</h2>
			<p>
				Normalize audio to a consistent loudness level (-10 LUFS). Upload one
				track or a whole album — tracks in an album are analyzed together so
				they stay consistent with each other.
			</p>

			<FilePicker
				processing={analyzing || processing}
				progress={progress}
				onFiles={(files) => processAudioFiles(files)}
			>
				<p style={{ color: "#a1a1aa", marginBottom: "0.5rem" }}>{stats}</p>
			</FilePicker>

			{results.length > 0 && (
				<ResultsList
					results={results}
					onDownloadAll={reset}
					onClear={reset}
				/>
			)}
		</section>
	);
}

export default NormalizeTab;
