# Day 10. Context Strategies Without Summary

## Task

Compare context management strategies that do not rely on LLM-generated summaries: Sliding Window, Sticky Facts, and Branching.

## What to Show in the Video

- Select `Day 10 Strategies`.
- Choose a strategy from the dropdown.
- Send the same scenario through each strategy.
- Show token metrics and context usage.
- Show how each strategy changes what gets sent to the model.

## Strategy Conclusions

- Sliding Window: simple and cheap, but old details disappear when they leave the recent window.
- Sticky Facts: stable preferences and decisions survive longer, but only facts explicitly captured as sticky facts are preserved.
- Branching: keeps separate task paths cleaner, but the user must choose the right branch and manage branches intentionally.

## Done When

- The UI provides a strategy dropdown.
- Day 10 has separate dialogs and storage.
- Sliding Window sends only recent messages.
- Sticky Facts sends extracted fact memory plus recent messages.
- Branching sends only the selected branch context.
