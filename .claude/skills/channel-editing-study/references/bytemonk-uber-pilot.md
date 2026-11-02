# Uber tracking explainer: fourth provisional report

## Provenance and coverage

- Source: an external analysis pasted by the user on 2026-11-02.
- Title and video URL/ID: not supplied in this report.
- Subject: driver tracking, ingestion, geospatial partitioning, storage and state.
- Reported duration: 11:36 (696 seconds).
- Reported examined window: 00:00-11:36, with picture/audio access, full-duration
  keyframe inspection, audio sampling and transcript mapping.
- Verification status: USER-SUPPLIED REPORT, NOT INDEPENDENTLY VERIFIED.
- No source frames, waveform, listening log, subtitle file or source-document
  links accompanied the report.
- Candidate identity: "How Uber Tracks 5 Million Drivers in Real Time",
  https://www.youtube.com/watch?v=R_wWbHqpQTg. This previously suggested link
  matches the subject/reported duration, but identity still needs confirmation.

"Observed" is the external report's label, not a calibrated confidence rating.
Claimed full audiovisual access is not independently reproduced toolkit access.
No exact renderer, source color profile or audio-processing chain is established.

## Reported sequence

All rows below are attributed report content, not direct observations.

| Reported range | Reported content | Original-production option |
|---|---|---|
| 00:00-00:34 | Moving cars/map, high-density ping grid, brand bumper | Begin with a familiar interface, then expose its scale |
| 00:34-02:29 | Overloaded database and three consumer/read paths | Explain competing access patterns with a fan-out diagram |
| 02:29-03:23 | Validate/deduplicate/sample pipeline | Reveal each processing stage only as it is introduced |
| 03:23-05:18 | Partitioning failures, globe and hexagonal lookup grid | Compare partition choices visually before selecting one |
| 05:18-06:53 | Live/history storage split and airport heartbeat scenario | Separate current state, durable history and expiry behavior |
| 06:53-09:08 | Competing reservations, conditional state update, architecture documents | Animate event ordering and the state transition explicitly |
| 09:08-11:10 | Noisy versus smoothed GPS path and architecture recap | Compare raw/processed signals, then connect mechanisms |
| 11:10-11:36 | Three follow-up topic cards and outro | Offer a useful next question rather than copying the creator's end card |

## Proposed visual vocabulary

- Original map paths and location markers with consistent scale and a legend.
  Use synthetic coordinates or appropriately licensed maps, not private trips.
- A labeled hexagonal grid for spatial grouping. A rounded rectangle is a card,
  not a hexagon: create a real six-sided polygon for that graphic.
- Split flow diagrams for live state versus durable history; label time and
  retention instead of conveying the distinction through color alone.
- A shared time axis for competing requests and an explicit state label for
  available/reserved. Distinguish a schematic from captured production behavior.
- Aligned raw/smoothed paths with a visible legend and disclosed illustrative
  data. An attractive animated path is not a measured filter result.
- Topic accents (locations/grids) and status accents (warning/success) remain
  separate design roles. Treat the reported hex swatches as creative proposals.

## Claims requiring verification

- "Five million drivers" and "five million pings per second" are different
  quantities. Verify population, cadence, concurrency, units and source date.
  Do not convert a title's driver count into an ingestion-rate measurement.
- Confirm actual storage products, H3 usage, partition behavior, TTL/heartbeat
  policy and conditional-update semantics against dated primary architecture
  documentation. A screenshot described as official documentation is not a citation.
- Verify the claimed Kalman filter, map-matching behavior and 100 ms buffer
  separately. Filtering, map matching and intentional buffering are distinct
  operations; do not infer one from a smooth-looking path.
- No cut-frequency measurement is supplied in this report. Do not fill the gap
  using numeric claims from earlier reports.
- Voice processing, automatic sidechain ducking, renderer names, exact color
  profiles and Free/Studio feature classifications remain unverified.

For current aggregate coverage and report selection, see the [study index](./study-index.md).
