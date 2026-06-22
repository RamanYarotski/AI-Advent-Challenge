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

Global invariants are stored in `task-invariants.json`, separately from the dialog, user profile, and Markdown memory files. Built-in invariants protect the host assistant and its orchestration architecture, while user invariants can be added from Settings for task-specific or project-specific rules.

Examples:

- This assistant's own host UI text stays in English.
- The assistant remains one unified workflow.
- Context strategy stays automatic.
- Profile preferences stay in confirmed profile suggestions.
- A task cannot be marked done before validation passes.

Validation receives the full active invariant set. A blocker violation keeps the task out of Done and returns it to Execution or asks for user input.

## Debugging

Settings -> Request context shows the assembled context plus task state, active invariants, stage-agent runs, swarm output, transition decisions, and validation result.
