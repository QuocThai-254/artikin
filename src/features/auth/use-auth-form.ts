"use client";

import { useRef, useState, type FormEvent } from "react";
import type { z } from "zod";

import { NETWORK_ERROR_MESSAGE, type AuthFormError } from "./errors";
import { toFieldErrors, type AuthFieldErrors, type AuthFieldName } from "./schemas";

type FieldValues = Partial<Record<AuthFieldName, string>>;

/**
 * State machine shared by the sign-in and sign-up forms: zod validation on submit (then live
 * while correcting), focus on the first invalid field, pending state and error placement.
 * `submit` resolves to `null` on success (the caller navigates) or to the error to show.
 * `initialError` (e.g. a failed OAuth round trip, known only after hydration) shows until the
 * first submit.
 */
export function useAuthForm<Values extends FieldValues>(options: {
  schema: z.ZodType<Values, FieldValues>;
  initialValues: FieldValues;
  initialError?: string;
  submit: (values: Values) => Promise<AuthFormError | null>;
}) {
  const { schema, submit } = options;
  const [values, setValues] = useState<FieldValues>(options.initialValues);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<AuthFormError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [validateLive, setValidateLive] = useState(false);
  const [pending, setPending] = useState(false);
  const inputs = useRef<Partial<Record<AuthFieldName, HTMLInputElement | null>>>({});
  const shownFormError =
    formError ?? (!submitted && options.initialError ? { message: options.initialError } : null);

  function focusFirstError(errors: AuthFieldErrors) {
    const first = (["name", "email", "password"] as const).find((field) => errors[field]);
    if (first) inputs.current[first]?.focus();
  }

  function setField(field: AuthFieldName, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (validateLive) {
      const result = schema.safeParse(next);
      setFieldErrors(result.success ? {} : toFieldErrors(result.error));
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setValidateLive(true);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errors = toFieldErrors(parsed.error);
      setFieldErrors(errors);
      setFormError(null);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    let failure: AuthFormError | null;
    try {
      failure = await submit(parsed.data);
    } catch {
      failure = { message: NETWORK_ERROR_MESSAGE };
    }
    if (!failure) return; // success: keep the pending state while the page navigates away
    setPending(false);
    if (failure.field) {
      const errors = { [failure.field]: failure.message };
      setFieldErrors(errors);
      focusFirstError(errors);
    } else {
      setFormError(failure);
    }
  }

  function inputRef(field: AuthFieldName) {
    return (element: HTMLInputElement | null) => {
      inputs.current[field] = element;
    };
  }

  return {
    values,
    setField,
    fieldErrors,
    formError: shownFormError,
    pending,
    onSubmit,
    inputRef,
  };
}
