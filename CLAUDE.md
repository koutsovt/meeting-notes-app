# Meeting Notes App

A macOS desktop application that:

- captures meeting audio locally
- transcribes using Whisper
- generates meeting summaries
- extracts action items
- exports notes

Architecture:

capture -> transcription -> intelligence -> storage -> export

Rules:
- modules must remain independent
- UI communicates only with the App Orchestrator
- shared contracts must be used
