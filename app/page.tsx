// Main UI: single-verify flow (UploadForm -> ResultsTable, one image + one
// application in, one result out) and the batch flow (BatchUploadPanel, a CSV manifest
// + many images in, a long-running processed-as-it-goes run out) — presented as two
// clearly labeled sections on one page, stacked one after the other, rather than tabs
// that hide one flow behind a click. Both are the same tool used two different ways;
// showing both at once (each under its own heading) means a first-time user never has
// to guess that a second flow exists somewhere behind a toggle. The usability bar
// throughout is a first-time, low-tech-comfort user (the "73-year-old first-time user"
// benchmark) — everything on the page is exactly what it looks like, nothing is hidden.

"use client";

import { useState } from "react";
import BatchUploadPanel from "@/components/BatchUploadPanel";
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
 * Home — the single page this app has. Holds the state ResultsTable needs for the
 * single-verify section (the most recent verification, if any); UploadForm and
 * BatchUploadPanel each own all of their own form/submit/progress state internally,
 * calling back here only when a single-verify result is ready (`onVerified`) — the
 * batch section has nothing to report upward, since it renders its own full progress
 * view in place.
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

        <section className={styles.section} aria-labelledby="single-verify-heading">
          <h2 id="single-verify-heading" className={styles.sectionHeading}>
            Single Label
          </h2>
          <UploadForm
            onVerified={(result, elapsedSeconds) => setLastVerification({ result, elapsedSeconds })}
          />

          {lastVerification && (
            <ResultsTable result={lastVerification.result} elapsedSeconds={lastVerification.elapsedSeconds} />
          )}
        </section>

        <section className={styles.section}>
          <BatchUploadPanel />
        </section>
      </main>
    </div>
  );
}
