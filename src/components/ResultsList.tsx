/**
 * Shared results list: header with track count, Download All and
 * Clear buttons, plus one Result card per track.
 *
 * Reads per-track metadata for zip naming; individual Result cards
 * read metadata for album art display.
 */
import JSZip from "jszip";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { useEffect, useState } from "react";

import { type FileResult } from "./FilePicker";
import Result from "./Result";

interface ResultsListProps {
	/** Processed results (name, buffer, URL). */
	results: FileResult[];
	/** Called when the user clicks Download All. */
	onDownloadAll(): void;
	/** Called when the user clicks Clear. */
	onClear(): void;
}

export interface TrackMeta {
	artist?: string;
	album?: string;
	imageUrl?: string;
}

/** Derive an album name from per-track metadata for zip download naming. */
function computeZipName(meta: TrackMeta[]): string {
	if (meta.length === 0) return "normalized";

	const allSameArtist = meta.every((m) => m.artist === meta[0].artist);
	const allSameAlbum = meta.every((m) => m.album === meta[0].album);

	const commonArtist = allSameArtist ? meta[0].artist : undefined;
	const commonAlbum = allSameAlbum ? meta[0].album : undefined;

	if (commonArtist && commonAlbum) {
		return `${commonArtist} - ${commonAlbum}`;
	}
	if (commonArtist) return commonArtist;
	if (commonAlbum) return commonAlbum;
	return "normalized";
}

function ResultsList({ results, onDownloadAll, onClear }: ResultsListProps) {
	const [resultMeta, setResultMeta] = useState<
		{ result: FileResult; metadata: TrackMeta }[]
	>([]);

	useEffect(() => {
		(async () => {
			setResultMeta(
				await Promise.all(
					results.map(
						(result) =>
							new Promise<{ result: FileResult; metadata: TrackMeta }>(
								(resolve) => {
									(async () => {
										const input = new Input({
											formats: ALL_FORMATS,
											source: new BufferSource(result.buffer),
										});

										const tags = await input.getMetadataTags();
										resolve({
											result,
											metadata: {
												artist: tags.albumArtist,
												album: tags.album,
												imageUrl: tags.images?.[0]
													? URL.createObjectURL(
															new Blob([new Uint8Array(tags.images[0].data)]),
														)
													: undefined,
											},
										});
									})();
								},
							),
					),
				),
			);
		})();
	}, [results]);

	const downloadAll = async () => {
		if (results.length === 1) {
			const a = document.createElement("a");
			a.href = results[0].url;
			a.download = results[0].name;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			onDownloadAll();
			return;
		}

		const zip = new JSZip();
		for (const result of results) {
			zip.file(result.name, new Uint8Array(result.buffer));
		}
		const blob = await zip.generateAsync({ type: "blob" });
		const zipName = computeZipName(resultMeta.map(({ metadata }) => metadata));
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${zipName}.zip`;
		a.style.display = "none";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(a.href);
		onDownloadAll();
	};

	return (
		<div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "1rem",
				}}
			>
				<h3>
					Results ({results.length} track
					{results.length > 1 ? "s" : ""})
				</h3>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<button
						onClick={downloadAll}
						style={{
							background: "#27272a",
							color: "#e4e4e7",
							border: "1px solid #3f3f46",
							borderRadius: "4px",
							padding: "0.375rem 0.75rem",
							cursor: "pointer",
						}}
					>
						Download All
					</button>
					<button
						onClick={onClear}
						style={{
							background: "transparent",
							color: "#71717a",
							border: "1px solid #3f3f46",
							borderRadius: "4px",
							padding: "0.375rem 0.75rem",
							cursor: "pointer",
						}}
					>
						Clear
					</button>
				</div>
			</div>

			{resultMeta.map((r, i) => (
				<Result key={i} result={r.result} meta={r.metadata} />
			))}
		</div>
	);
}

export default ResultsList;
