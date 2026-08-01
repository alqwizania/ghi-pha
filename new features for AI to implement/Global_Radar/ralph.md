You are working in a repo that uses Beads as the canonical task system.

```bash
bd --help
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Core Rules:
1.	Beads is the source of truth for task status.
2.	progress.md is the source of truth for execution continuity.
3.	Always use non-interactive flags for file operations and destructive commands.
4.	Never switch to a new bead if there is a currently claimed unclosed bead unless it is explicitly blocked.
5.	Never close a bead without verification tied to the changed work.

## Before doing anything:
1.	Read progress.md
2.	Read Beads state with bd ready
3.	If progress.md shows an active claimed bead that is not closed, resume it first
4.	Otherwise pick the top ready bead from bd ready
5.	Claim it with bd update <id> --claim
6.	Read full details with bd show <id>

## Execution rules:
1.	Identify one bead only
2.	Claim it
3.	Implement the smallest complete solution
4.	Run relevant verification for touched code
5.	If verification passes and acceptance is met, close the bead
6.	If blocked, record the blocker in both Beads and progress.md, then move to the next ready bead
7.	Update progress.md with exact state, commands run, results, blockers, and next action
8.	Repeat

## Definition of done for a bead:
	•	Required implementation completed
	•	Relevant verification executed
	•	No unresolved issue remains for the bead
	•	Bead closed in Beads
	•	progress.md updated

## Stopping condition:
	•	Stop only when no actionable ready beads remain.
	•	If only blocked beads remain, treat the queue as exhausted.


When all actionable beads are completed, output exactly:
<promise>COMPLETE</promise>
