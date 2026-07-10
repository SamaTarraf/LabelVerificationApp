// Dispatches by field name: alcoholContent/netContents/warningText go through their
// algorithmic matcher above; every other field (known-fuzzy or unrecognized) passes
// through *unchanged* — its status and explanation already came back from the
// extraction call, nothing left to compute.
// Stub: real implementation not yet written.
