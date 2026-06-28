# Day 13-15. Orchestrated Task Lifecycle

Day 13-15 combines the challenge ideas from task state, invariants, swarms, and controlled transitions into one upgrade for the unified assistant.

The assistant still behaves as one product. Users do not pick context strategies, switch to separate day tabs, or bypass orchestration. Internally, every user turn now runs through a persisted lifecycle:

```text
Planning -> Execution -> Validation -> Done
```

## Task Orchestrator

The task orchestrator owns the active task run:

- task text;
- current state;
- step and total;
- plan;
- completed work;
- current action;
- stage artifacts;
- agent runs;
- swarm runs;
- transition decisions;
- validation result.

This state is stored in the existing short-term JSON document store, so a task can pause and continue without being re-explained.

Planning produces a structured requirements contract with the goal, target location, requirements, constraints, assumptions, acceptance criteria, and open questions. The orchestrator keeps the task in Planning while the contract has open questions or is not ready for approval, then asks for explicit user approval before allowing Execution.

## Stage Agents

The orchestrator routes work through specialized stage-agent contracts:

- Planning Agent: extracts requirements and a safe plan.
- Execution Agent: produces a draft artifact from the current plan.
- Validation Agent: checks the draft against invariants and stage contracts.
- Done Agent: finalizes only after validation passes.

Stage agents receive stage-local context instead of the full raw chat history. Planning can inspect selected branch and memory summaries; Execution receives the approved plan and planning summary; Validation receives the execution draft and active invariants; Done receives only the passed validation result and final draft. The orchestrator owns all state transitions.

## Planning Swarm

Planning uses a small swarm:

- Requirements Planning Agent;
- Invariant Planning Agent;
- Context Planning Agent.

Their separate findings are aggregated by the orchestrator into one plan, one set of task-derived invariants, and one transition decision.

## Invariants

User-managed invariants are stored in `task-invariants.json`, separately from the dialog, user profile, and Markdown memory files. Each user invariant is owned by the active dialog, appears only while that dialog is active, and is deleted when the dialog is deleted. Internal architecture rules protect the host assistant and lifecycle in code, but they are not shown in Settings and are not saved as user invariants.

Examples:

- Use only free APIs for this task.
- Do not suggest Java for this project.
- Keep the generated artifact compatible with a browser runtime.
- Limit dependencies to a small, reviewable set.

Each lifecycle stage receives active user invariants plus task-local invariants generated for the current task run. The orchestrator checks each stage artifact with an internal semantic invariant gate after the stage agent responds. The gate judges the artifact against invariant meaning instead of keyword, regex, or technology-specific rules, and blocker invariants fail closed if the gate cannot verify the artifact.

Planning cannot offer an approval-ready plan that violates blockers, Approval re-checks the saved plan before `Planning -> Execution`, Execution cannot send a conflicting draft to Validation, Validation cannot pass a conflicting draft, and Done cannot finalize a conflicting answer. Task-local invariants stay with the task run instead of becoming global Settings rules.

## Debugging

The main task run panel shows the active lifecycle state, plan, requirements status, active invariant count, swarm activity, and validation result.
