// Main UI (single-verify portion only — batch UI is a later phase and is not stubbed
// here). Wires UploadForm (image + application fields in) to ResultsTable (result out)
// behind a single, linear flow: read the intro, upload, click Verify, read the result.
// The usability bar is a first-time, low-tech-comfort user (the "73-year-old
// first-time user" benchmark) — one form, one button, one result area, no hunting
// for anything.

"use client";

import { useState } from "react";
import UploadForm from "@/components/UploadForm";
import ResultsTable from "@/components/ResultsTable";
import type { VerificationResult } from "@/lib/types";
import styles from "./page.module.css";

/** The most recent completed verification: the result itself plus how long the round
 * trip took, kept together since ResultsTable needs both to render the "Verified in
 * X.Xs" line. `null` until the first verification finishes. */
type LastVerification = {
  result: VerificationResult;
  elapsedSeconds: number;
};

/**
 * Home — the single page this app has so far. Holds only the state ResultsTable needs
 * (the most recent verification, if any); UploadForm owns all of its own form/submit
 * state internally and calls back here only once a verification has actually
 * succeeded, via `onVerified`.
 */
export default function Home() {
  const [lastVerification, setLastVerification] = useState<LastVerification | null>(null);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Label Verification</h1>
          <p>
            Upload a photo of an alcohol beverage label along with the details from its
            application below. The tool checks whether the label matches the
            application and explains anything that does not.
          </p>
        </header>

        <UploadForm
          onVerified={(result, elapsedSeconds) => setLastVerification({ result, elapsedSeconds })}
        />

        {lastVerification && (
          <ResultsTable result={lastVerification.result} elapsedSeconds={lastVerification.elapsedSeconds} />
        )}
      </main>
    </div>
  );
}
