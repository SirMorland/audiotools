# AudioTools

Browser-based audio processing toolkit — no server, everything runs locally in your browser.

## Tools

### Normalize

Loudness normalizer that brings audio to a consistent **-10 LUFS**. Upload a single track or an entire album — tracks in an album are analyzed together so relative levels stay consistent across the set.

### Nightcorefy

Upload audio files to apply the nightcore effect (sped up & pitched up). Each track is converted to lossless FLAC on output.

## Getting Started

```bash
# Install dependencies
bun install

# Start dev server
bun dev

# Build for production
bun run build
```

## Deploy

Built artifacts are auto-deployed to the `gh-pages` branch on every push to `main` via GitHub Actions.
