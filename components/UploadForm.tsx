// UploadForm — the single-label verification form: an image file picker, a small
// static set of labeled text inputs for the common application fields (see
// KNOWN_FIELDS below), a user-extensible list of additional name/value fields for
// anything KNOWN_FIELDS doesn't have a dedicated input for, a Verify button, and an
// inline error state with a Retry button for any failed request — including a
// client-side timeout, which is deliberately treated as just another failure, not a
// separate UI path.

"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { ApplicationData, VerificationResult } from "@/lib/types";
import styles from "./UploadForm.module.css";

/** One entry in the static application-field form: its ApplicationData key, its
 * on-screen label, an example placeholder drawn from a sample bourbon label
 * ("OLD TOM DISTILLERY"), and whether it needs a multi-line textarea instead of
 * a single-line input (only the Government Warning body is long enough to need one). */
export type KnownField = {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
};

/**
 * The set of application fields this single-verify form gives a dedicated, labeled
 * input for — just the common fields a label typically has. ApplicationData itself is
 * an open field set (see lib/types.ts), and this form isn't limited to this list: the
 * "Other application fields" section below lets the user add any additional
 * name/value pairs the application has that aren't one of these seven. Also imported
 * by ResultsTable.tsx so a field's label reads identically in the input form and the
 * results it produced.
 */
export const KNOWN_FIELDS: readonly KnownField[] = [
  { key: "brandName", label: "Brand Name", placeholder: "OLD TOM DISTILLERY" },
  { key: "classType", label: "Class/Type", placeholder: "Kentucky Straight Bourbon Whiskey" },
  { key: "alcoholContent", label: "Alcohol Content (ABV)", placeholder: "45% Alc./Vol. (90 Proof)" },
  { key: "netContents", label: "Net Contents", placeholder: "750 mL" },
  { key: "producer", label: "Producer (Name & Address)", placeholder: "OLD TOM DISTILLERY, LOUISVILLE, KY" },
  { key: "countryOfOrigin", label: "Country of Origin", placeholder: "Leave blank if this is not an import" },
  {
    key: "warningText",
    label: "Government Warning Text",
    placeholder:
      "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic " +
      "beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic " +
      "beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    multiline: true,
  },
];

/**
 * Client-side abort timeout, in milliseconds. Deliberately set *after* the API route's
 * own 8s `maxDuration` (see app/api/verify/route.ts) so this abort only ever fires once
 * the server call was never going to finish in time anyway — it is a backstop against
 * the server not responding at all (network failure, dropped connection), never a race
 * against a server call that is still on track to finish.
 */
const CLIENT_ABORT_MS = 10_000;

export type UploadFormProps = {
  /** Called once a verification request completes successfully, with the parsed
   * VerificationResult and the wall-clock time (in seconds) the round trip took. */
  onVerified: (result: VerificationResult, elapsedSeconds: number) => void;
};

/** One user-added application field not covered by KNOWN_FIELDS — e.g. a vintage year,
 * appellation, or any other column an application might have that this static form has
 * no dedicated input for. `id` is a stable React key independent of `name`, since `name`
 * is free-text and edited in place (two rows could briefly share a name while typing). */
type CustomField = {
  id: string;
  name: string;
  value: string;
};

/**
 * Builds the ApplicationData object to submit from the current field inputs, omitting
 * any field the user left blank. An empty string is "not filled in yet", not "the
 * label should say nothing" — ApplicationData's own convention for "not applicable to
 * this application" is an absent key, not an empty string value (see lib/types.ts), so
 * blank fields are dropped here rather than sent through as empty strings. Custom fields
 * (see CustomField above) are merged in the same way, keyed by their user-typed name —
 * ApplicationData is an open field set, so nothing about this shape restricts it to
 * KNOWN_FIELDS alone; that list is just what this form gives a dedicated input for.
 */
function buildApplicationData(fieldValues: Record<string, string>, customFields: CustomField[]): ApplicationData {
  const data: ApplicationData = {};
  for (const field of KNOWN_FIELDS) {
    const trimmedValue = fieldValues[field.key]?.trim();
    if (trimmedValue) {
      data[field.key] = trimmedValue;
    }
  }
  for (const customField of customFields) {
    const trimmedName = customField.name.trim();
    const trimmedValue = customField.value.trim();
    if (trimmedName && trimmedValue) {
      data[trimmedName] = trimmedValue;
    }
  }
  return data;
}

/**
 * UploadForm — collects one label image and its application field values, submits them
 * to POST /api/verify, and reports the parsed result back to the parent page. Manages
 * its own submitting/error state so the Verify button and error-with-retry UI live
 * right next to the fields they belong to, rather than being threaded through the
 * parent component.
 */
export default function UploadForm({ onVerified }: UploadFormProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleFieldChange(key: string, value: string) {
    setFieldValues((previous) => ({ ...previous, [key]: value }));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    setImageFile(event.target.files?.[0] ?? null);
  }

  /** Appends a blank custom field row for the user to fill in — the escape hatch for
   * any application field the static KNOWN_FIELDS list has no dedicated input for. */
  function addCustomField() {
    setCustomFields((previous) => [
      ...previous,
      { id: crypto.randomUUID(), name: "", value: "" },
    ]);
  }

  function updateCustomField(id: string, key: "name" | "value", newValue: string) {
    setCustomFields((previous) =>
      previous.map((field) => (field.id === id ? { ...field, [key]: newValue } : field))
    );
  }

  function removeCustomField(id: string) {
    setCustomFields((previous) => previous.filter((field) => field.id !== id));
  }

  /**
   * Submits the currently-selected image + field values to POST /api/verify. Validates
   * locally first (an image must be chosen; at least one application field must be
   * filled in, otherwise there is nothing meaningful to check) before making the
   * request. Also doubles as the Retry handler: it simply re-reads the current form
   * state, so clicking Retry after a failure re-sends exactly what was last submitted
   * without requiring the user to re-select the image or re-type anything.
   */
  async function submitVerification() {
    if (!imageFile) {
      setErrorMessage("Please choose a label image first.");
      return;
    }

    const applicationData = buildApplicationData(fieldValues, customFields);
    if (Object.keys(applicationData).length === 0) {
      setErrorMessage("Please fill in at least one field from the application before verifying.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("image", imageFile);
    formData.append("applicationData", JSON.stringify(applicationData));

    // The abort timer is armed for the whole request; cleared in `finally` however the
    // request settles (success, server error, or the abort itself) so it never fires
    // late against a request that already finished.
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), CLIENT_ABORT_MS);
    const startTime = performance.now();

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      const elapsedSeconds = (performance.now() - startTime) / 1000;

      if (!response.ok) {
        // The route always responds with `{ error: string }` on failure (see
        // app/api/verify/route.ts) — fall back to a generic message if that shape isn't
        // there for some reason (e.g. a platform-level error page instead of our JSON).
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Verification failed (HTTP ${response.status}).`);
      }

      const result = (await response.json()) as VerificationResult;
      onVerified(result, elapsedSeconds);
    } catch (error) {
      // AbortError specifically means the client-side timeout above fired, not the
      // server itself returning an error response. Both cases land in the same
      // errorMessage state and the same message+Retry UI below — a timeout is not a
      // separate error path, per the plan.
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Verification timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "Verification failed for an unknown reason.";
      setErrorMessage(message);
    } finally {
      clearTimeout(abortTimer);
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitVerification();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="label-image">Label Image</label>
        <input id="label-image" type="file" accept="image/*" onChange={handleImageChange} required />
      </div>

      {KNOWN_FIELDS.map((field) =>
        field.multiline ? (
          <div className={styles.field} key={field.key}>
            <label htmlFor={field.key}>{field.label}</label>
            <textarea
              id={field.key}
              placeholder={field.placeholder}
              value={fieldValues[field.key] ?? ""}
              onChange={(event) => handleFieldChange(field.key, event.target.value)}
              rows={3}
            />
          </div>
        ) : (
          <div className={styles.field} key={field.key}>
            <label htmlFor={field.key}>{field.label}</label>
            <input
              id={field.key}
              type="text"
              placeholder={field.placeholder}
              value={fieldValues[field.key] ?? ""}
              onChange={(event) => handleFieldChange(field.key, event.target.value)}
            />
          </div>
        )
      )}

      <div className={styles.customFieldsSection}>
        <span className={styles.customFieldsLabel}>
          Other application fields (not listed above)
        </span>
        {customFields.map((customField) => (
          <div className={styles.customFieldRow} key={customField.id}>
            <input
              type="text"
              className={styles.customFieldName}
              placeholder="Field name (e.g. Vintage)"
              value={customField.name}
              onChange={(event) => updateCustomField(customField.id, "name", event.target.value)}
              aria-label="Custom field name"
            />
            <input
              type="text"
              className={styles.customFieldValue}
              placeholder="Value from the application"
              value={customField.value}
              onChange={(event) => updateCustomField(customField.id, "value", event.target.value)}
              aria-label="Custom field value"
            />
            <button
              type="button"
              className={styles.removeFieldButton}
              onClick={() => removeCustomField(customField.id)}
              aria-label={`Remove ${customField.name || "custom"} field`}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={styles.addFieldButton} onClick={addCustomField}>
          + Add another field
        </button>
      </div>

      {errorMessage && (
        <div className={styles.errorBadge} role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => void submitVerification()} disabled={isSubmitting}>
            Retry
          </button>
        </div>
      )}

      <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
        {isSubmitting ? "Verifying..." : "Verify Label"}
      </button>
    </form>
  );
}
