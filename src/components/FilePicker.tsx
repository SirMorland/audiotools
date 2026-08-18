/**
 * Shared file picker: drag-and-drop zone plus hidden file input.
 *
 * Supports dropping files and folders (via webkitGetAsEntry).
 */
import {
	type ChangeEvent,
	type DragEvent,
	type PropsWithChildren,
	useCallback,
	useRef,
} from "react";

export interface FileResult {
	/** Display name (without original extension). */
	name: string;
	/** Object URL for the processed audio. */
	url: string;
	/** Processed audio buffer. */
	buffer: ArrayBuffer;
}

interface FilePickerProps {
	/** Called with the raw selected files when the user picks or drops them. */
	onFiles(files: File[]): void;
	/** Whether processing is in progress (disables input, shows "Processing…" label). */
	processing?: boolean;
	progress?: string;
	/** Accepted MIME/type filter (default "audio/*"). */
	accept?: string;
}

/** File types accepted by both tabs. */
const AUDIO_EXTS = new Set([
	"flac",
	"mp3",
	"wav",
	"ogg",
	"m4a",
	"wma",
	"aac",
	"opus",
	"webm",
]);

/**
 * Returns true if the file looks like audio by MIME type or extension.
 */
function isAudioFile(file: File): boolean {
	if (file.type.startsWith("audio/")) return true;
	const ext = file.name.split(".").pop()?.toLowerCase();
	return ext !== undefined && AUDIO_EXTS.has(ext);
}

/**
 * Recursively read all files from a dropped entry.
 */
async function readEntry(entry: FileSystemEntry): Promise<File[]> {
	const files: File[] = [];

	if (entry.isDirectory) {
		const reader = (entry as FileSystemDirectoryEntry).createReader();
		const entries: FileSystemEntry[] = [];

		// readEntries may return fewer entries than exist; loop until empty
		while (true) {
			const batch = await new Promise<FileSystemEntry[]>((resolve) => {
				reader.readEntries((e) => resolve(e));
			});
			if (batch.length === 0) break;
			entries.push(...batch);
		}

		await Promise.all(
			entries.map((e) => readEntry(e).then((fs) => files.push(...fs))),
		);
	} else if (entry.isFile) {
		const file = await new Promise<File>((resolve) => {
			(entry as FileSystemFileEntry).file((f) => resolve(f));
		});
		if (isAudioFile(file)) {
			files.push(file);
		}
	}

	return files;
}

/**
 * Extract audio files from a drag event, supporting both direct files and
 * folder drops via webkitGetAsEntry. Non-audio files are silently dropped.
 */
async function extractFilesFromDrag(
	items: DataTransferItemList,
): Promise<File[]> {
	const files: File[] = [];
	const promises: Promise<void>[] = [];

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const entry = item.webkitGetAsEntry?.();

		if (entry) {
			promises.push(
				readEntry(entry).then((entryFiles) => {
					files.push(...entryFiles);
				}),
			);
		} else if (item.kind === "file") {
			promises.push(
				new Promise<void>((resolve) => {
					const file = item.getAsFile();
					if (file && isAudioFile(file)) files.push(file);
					resolve();
				}),
			);
		}
	}

	await Promise.all(promises);
	return files;
}

function FilePicker({
	onFiles,
	processing,
	progress,
	accept = "audio/*",
	children,
}: PropsWithChildren<FilePickerProps>) {
	const inputRef = useRef<HTMLInputElement>(null);

	const onFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			if (event.target.files) {
				onFiles(Array.from(event.target.files));
				// Reset so the same file can be selected again
				event.target.value = "";
			}
		},
		[onFiles],
	);

	const onDrop = useCallback(
		async (event: DragEvent) => {
			event.preventDefault();
			const files = await extractFilesFromDrag(event.dataTransfer.items);
			if (files.length > 0) {
				onFiles(files);
			}
		},
		[onFiles],
	);

	const onDragOver = useCallback((event: DragEvent) => {
		event.preventDefault();
	}, []);

	return (
		<>
			<div
				onDrop={onDrop}
				onDragOver={onDragOver}
				style={{
					border: "2px dashed #3f3f46",
					borderRadius: "8px",
					padding: "2rem",
					textAlign: "center",
					marginBottom: "1rem",
					transition: "border-color 0.15s",
				}}
			>
				<input
					ref={inputRef}
					type="file"
					multiple
					onChange={onFileChange}
					accept={accept}
					style={{ display: "none" }}
				/>
				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					style={{
						background: "transparent",
						border: "none",
						color: processing ? "#71717a" : "#a1a1aa",
						cursor: processing ? "default" : "pointer",
						fontSize: "inherit",
					}}
				>
					{processing ? "Processing…" : "Choose files or folder"}
				</button>
			</div>

			{children}

			{progress && (
				<p style={{ color: "#a1a1aa", marginBottom: "0.5rem" }}>{progress}</p>
			)}
		</>
	);
}

export default FilePicker;
