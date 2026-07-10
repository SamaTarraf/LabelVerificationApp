// Dispatches by field name: alcoholContent/netContents/warningText go through their
// algorithmic matcher above; every other field (known-fuzzy or unrecognized) passes
// through *unchanged* — its status and explanation already came back from the
// extraction call, nothing left to compute.
// See ARCHITECTURE.md "Directory Structure" / "Matching" key decision and Phase 3 of
// PLAN_00_LABEL_VERIFICATION_APP.md.
// Stub: implemented in Phase 3.
