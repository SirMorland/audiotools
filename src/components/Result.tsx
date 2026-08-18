/**
 * Per-track result card: displays album art (if available),
 * track name, audio player, and download link.
 *
 * Reads metadata from the buffer internally via useFileMetadata,
 * so parent components don't need to handle it.
 */
import { type FileResult } from "./FilePicker";
import type { TrackMeta } from "./ResultsList";

interface ResultProps {
	result: FileResult;
	meta: TrackMeta;
}

function Result({ result, meta }: ResultProps) {
	return (
		<div
			style={{
				border: "1px solid #27272a",
				borderRadius: "6px",
				padding: "0.75rem",
				marginBottom: "0.5rem",
				...(meta.imageUrl
					? {
							display: "grid",
							gridTemplateColumns: "max-content 1fr",
							gap: "0.75rem",
						}
					: {}),
			}}
		>
			{meta.imageUrl && <img src={meta.imageUrl} />}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr max-content",
					alignContent: "space-between",
					gap: "0.75rem",
				}}
			>
				<p style={{ fontWeight: 500 }}>{result.name}</p>
				<div>
					<a
						href={result.url}
						download={result.name}
						style={{ color: "#818cf8", fontSize: "0.875rem" }}
					>
						↓ Download
					</a>
				</div>
				<audio
					src={result.url}
					controls
					style={{ width: "100%", gridColumn: "span 2" }}
				/>
			</div>
		</div>
	);
}

export default Result;
