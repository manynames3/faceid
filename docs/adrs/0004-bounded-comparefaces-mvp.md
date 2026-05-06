# ADR 0004: Use Bounded Rekognition CompareFaces For The MVP

## Status

Accepted

## Context

The first backend needs a deployable face-matching path without adding image-cropping dependencies or a custom ML service.

## Decision

Index reference faces with Rekognition `IndexFaces`, but match uploaded photos by comparing them against a capped number of stored reference images using `CompareFaces`.

## Consequences

- The Lambda remains dependency-light and easy to package.
- Cost is controlled through `MAX_COMPARE_PEOPLE` and `MAX_REFS_PER_PERSON`.
- This is not the best long-term algorithm for large datasets or crowded group photos.
