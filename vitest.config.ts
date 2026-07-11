// Vitest configuration. Every test file up through Phase 6 only ever imported its
// subject via a relative path (e.g. "./cookie"), so this project never needed a Vitest
// config of its own — Vitest's own defaults were enough. Phase 7's route files are the
// first to be imported *by a test* while themselves using the "@/..." path alias
// (already an established convention elsewhere in this codebase, e.g. the single-verify
// API route) — Next.js's own bundler resolves that alias automatically from tsconfig's
// "paths" entry, but Vitest runs independently of Next's bundler and doesn't know about
// it unless told here. Without this file, importing a route module in a test throws
// "Cannot find package '@/...'" the moment that module's own import statements run.
//
// The alias key is "@/" (with the trailing slash), not bare "@" — matching only import
// specifiers that literally start with "@/" is what keeps this from also catching (and
// incorrectly redirecting) a real npm scoped-package import like "@vercel/blob", which
// also starts with "@" but isn't this app's own path alias.

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/": `${path.resolve(__dirname)}/`,
    },
  },
});
