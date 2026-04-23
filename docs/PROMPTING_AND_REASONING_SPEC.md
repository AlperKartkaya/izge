# PROMPTING_AND_REASONING_SPEC.md
## Structured Prompting and Reasoning Design

## Purpose
The system must not rely on one giant prompt.
It must use prompts in bounded, role-specific stages.

## Core prompting stages
- Extraction prompt
- Entity normalization prompt
- Contradiction analysis prompt
- Assumption drift prompt
- Guidance prompt
- Result composition prompt

## Validation rules
All model outputs should be validated for:
- schema compliance,
- required fields,
- workspace scope,
- evidence references,
- non-empty rationale when claims are strong.

## Evidence rule
The model should not produce major historical claims without supporting evidence references.

## Reasoning rule
The product should reason over:
- graph state,
- retrieved evidence,
- structured memory objects,
not just raw concatenated text.
