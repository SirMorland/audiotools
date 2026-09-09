import { useCallback, useState } from "react";

import { nightcorefy } from "../../lib/nightcorefy";
import FilePicker, { type FileResult } from "./FilePicker";
import ResultsList from "./ResultsList";

function NightcoreTab() {
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState<string>();
	const [results, setResults] = useState<FileResult[]>([]);

	const reset = useCallback(() => {
		for (const r of results) {
			URL.revokeObjectURL(r.url);
		}
		setResults([]);
		setProgress(undefined);
	}, [results]);

	const processFiles = async (files: File[]) => {
		if (files.length === 0) {
			setProgress("No audio files found.");
			return;
		}

		reset();
		setProcessing(true);

		try {
			const trackResults: FileResult[] = [];

			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				setProgress(`Processing ${i + 1}/${files.length}: ${file.name}`);

				const buffer = await file.arrayBuffer();
				const resultBuffer = await nightcorefy(buffer);

				const blob = new Blob([resultBuffer], { type: "audio/flac" });
				const url = URL.createObjectURL(blob);
				const name = file.name.replace(/\.[^.]+$/, "") + ".flac";

				trackResults.push({
					name,
					buffer: resultBuffer,
					url,
				});
			}

			setResults(trackResults);
			setProgress(undefined);
		} catch (err) {
			setProgress(`Error: ${(err as Error).message}`);
		} finally {
			setProcessing(false);
		}
	};

	return (
		<section>
			<h2>Nightcorefy</h2>
			<p>
				Upload FLAC files to apply the nightcore effect (sped up &amp; pitched
				up).
			</p>

			<FilePicker
				processing={processing}
				progress={progress}
				onFiles={(files) => processFiles(files)}
			/>

			{results.length > 0 && (
				<ResultsList results={results} onDownloadAll={reset} onClear={reset} />
			)}
		</section>
	);
}

export default NightcoreTab;
