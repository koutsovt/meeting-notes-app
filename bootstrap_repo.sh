#!/bin/bash

echo "Creating repo structure..."

mkdir -p .claude/agents
mkdir -p .claude/skills/implement-module
mkdir -p .claude/skills/review-module
mkdir -p .claude/skills/test-module

mkdir -p apps/desktop-tauri/src/orchestrator
mkdir -p modules/{capture,transcription,intelligence,storage,export}
mkdir -p shared/{types,services,prompts,utils}
mkdir -p tests
mkdir -p docs/architecture

echo "Creating CLAUDE.md..."

cat > CLAUDE.md << 'EOF'
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
EOF


echo "Creating agents..."

cat > .claude/agents/rust-audio.md << 'EOF'
---
name: rust-audio
description: Specialist for macOS audio capture and Rust audio processing
tools: Read, Edit, Bash
---

Responsible for macOS system audio capture and emitting AudioChunk objects.
EOF


cat > .claude/agents/whisper-integrator.md << 'EOF'
---
name: whisper-integrator
description: Whisper transcription pipeline specialist
tools: Read, Edit
---

Handles whisper.cpp integration and transcript generation.
EOF


cat > .claude/agents/notes-intelligence.md << 'EOF'
---
name: notes-intelligence
description: Generates summaries and action items
tools: Read, Edit
---

Creates MeetingSummary objects from transcripts.
EOF


cat > .claude/agents/qa-reviewer.md << 'EOF'
---
name: qa-reviewer
description: Reviews architecture and tests
tools: Read
---

Ensures architecture rules and test coverage.
EOF


echo "Creating skills..."

cat > .claude/skills/implement-module/SKILL.md << 'EOF'
---
name: implement-module
description: Implement a module following architecture
---

Steps:
1. read CLAUDE.md
2. inspect shared contracts
3. implement module
4. add tests
EOF


cat > .claude/skills/review-module/SKILL.md << 'EOF'
---
name: review-module
description: Review module correctness
---

Steps:
1. inspect module
2. verify contracts
3. report issues
EOF


cat > .claude/skills/test-module/SKILL.md << 'EOF'
---
name: test-module
description: Generate tests
---

Steps:
1. detect interfaces
2. generate tests
3. run tests
EOF


echo "Creating shared types..."

cat > shared/types/audio.ts << 'EOF'
export interface AudioChunk {
  id: string
  meetingId: string
  sequence: number
  startTimeMs: number
  endTimeMs: number
  source: "system" | "microphone"
  createdAt: string
}
EOF


echo "Creating architecture doc..."

cat > docs/architecture/system-flow.md << 'EOF'
Start Meeting
↓
Capture Audio
↓
AudioChunk
↓
Transcription
↓
Transcript
↓
Summary
↓
Storage
↓
Export
EOF


echo "Bootstrap complete."