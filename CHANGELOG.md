# Changelog

## 0.1.3

- Add optional UTC daily-challenge identity and attempt metadata to run starts.
- Reject malformed challenge dates and inconsistent attempt counters.
- Expand the runtime examples and document capability-gated proofs, completion states,
  lifecycle handling, and the standalone manual-release path; ignore local npm auth and
  tarball artifacts.

## 0.1.2

- Point package metadata and contributor documentation at the public GitHub repository.
- Scope monorepo release-tag validation to Arcade SDK tags.

## 0.1.1

- Remove the non-portable implicit `prepack` lifecycle hook.
- Strengthen release checks for every export target and generated source map.
- Document the single protected-tag publishing path.

## 0.1.0

- Add the versioned `emergent.arcade.v1` browser bridge.
- Support lifecycle, run, settings, fullscreen, and telemetry APIs.
- Validate portal origins, protocol envelopes, request correlation, and timeouts.
