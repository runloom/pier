import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { type FormEvent, type JSX, useId, useState } from "react";
import { SSH_MAX_PORT, type SshHost } from "../shared/hosts.ts";
import type { Translate } from "./translate.ts";

const FORM_DIALOG_ID = "hosts.form";

interface HostFormContentProps extends RendererPluginContentDialogRenderProps {
  context: ExternalRendererPluginContext;
  initial: SshHost | null;
  onError: (error: unknown) => void;
  t: Translate;
}

interface HostFormValidation {
  host?: string;
  port?: string;
}

function validate(
  hostValue: string,
  portValue: string,
  t: Translate
): { errors: HostFormValidation; port?: number } {
  const errors: HostFormValidation = {};
  if (hostValue.trim().length === 0) {
    errors.host = t(
      "pier.ssh.form.hostRequired",
      "Enter a hostname, IP address, or ssh config alias."
    );
  }
  if (portValue.trim().length === 0) {
    return { errors };
  }
  const port = Number.parseInt(portValue.trim(), 10);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > SSH_MAX_PORT ||
    String(port) !== portValue.trim()
  ) {
    errors.port = t(
      "pier.ssh.form.portInvalid",
      "Enter a port between 1 and 65535."
    );
    return { errors };
  }
  return { errors, port };
}

function HostFormContent({
  close,
  context,
  initial,
  onError,
  t,
}: HostFormContentProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [port, setPort] = useState(
    initial?.port === undefined ? "" : String(initial.port)
  );
  const [identityFile, setIdentityFile] = useState(initial?.identityFile ?? "");
  const [errors, setErrors] = useState<HostFormValidation>({});
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const hostId = useId();
  const userId = useId();
  const portId = useId();
  const identityFileId = useId();

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const result = validate(host, port, t);
    setErrors(result.errors);
    if (result.errors.host || result.errors.port) {
      return;
    }
    const trimmedHost = host.trim();
    const record: SshHost = {
      host: trimmedHost,
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim().length > 0 ? name.trim() : trimmedHost,
      ...(user.trim().length > 0 ? { user: user.trim() } : {}),
      ...(result.port === undefined ? {} : { port: result.port }),
      ...(identityFile.trim().length > 0
        ? { identityFile: identityFile.trim() }
        : {}),
    };
    setSaving(true);
    context.rpc
      .invoke("hosts.upsert", { host: record })
      .then(() => {
        close(record.id);
      })
      .catch((error: unknown) => {
        setSaving(false);
        onError(error);
      });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <FieldGroup>
        <Field data-invalid={errors.host ? true : undefined}>
          <FieldLabel htmlFor={hostId}>
            {t("pier.ssh.form.host", "Host")}
          </FieldLabel>
          <Input
            aria-invalid={errors.host ? true : undefined}
            autoFocus={!initial}
            id={hostId}
            onChange={(event) => setHost(event.target.value)}
            placeholder="example.com"
            value={host}
          />
          {errors.host ? (
            <FieldError>{errors.host}</FieldError>
          ) : (
            <FieldDescription>
              {t(
                "pier.ssh.form.hostDescription",
                "Hostname, IP address, or an alias from your ssh config."
              )}
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={nameId}>
            {t("pier.ssh.form.name", "Display name")}
          </FieldLabel>
          <Input
            id={nameId}
            onChange={(event) => setName(event.target.value)}
            placeholder={host.trim() || "dev-server"}
            value={name}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={userId}>
              {t("pier.ssh.form.user", "User (optional)")}
            </FieldLabel>
            <Input
              id={userId}
              onChange={(event) => setUser(event.target.value)}
              placeholder="root"
              value={user}
            />
          </Field>
          <Field data-invalid={errors.port ? true : undefined}>
            <FieldLabel htmlFor={portId}>
              {t("pier.ssh.form.port", "Port (optional)")}
            </FieldLabel>
            <Input
              aria-invalid={errors.port ? true : undefined}
              id={portId}
              inputMode="numeric"
              onChange={(event) => setPort(event.target.value)}
              placeholder="22"
              value={port}
            />
            {errors.port ? <FieldError>{errors.port}</FieldError> : null}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={identityFileId}>
            {t("pier.ssh.form.identityFile", "Identity file (optional)")}
          </FieldLabel>
          <Input
            className="font-mono"
            id={identityFileId}
            onChange={(event) => setIdentityFile(event.target.value)}
            placeholder={t(
              "pier.ssh.form.identityFilePlaceholder",
              "~/.ssh/id_ed25519"
            )}
            value={identityFile}
          />
        </Field>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button
          disabled={saving}
          onClick={() => close(null)}
          type="button"
          variant="outline"
        >
          {t("pier.ssh.hosts.settings.cancel", "Cancel")}
        </Button>
        <Button disabled={saving} type="submit">
          {t("pier.ssh.hosts.settings.save", "Save")}
        </Button>
      </div>
    </form>
  );
}

export function openHostFormDialog(options: {
  context: ExternalRendererPluginContext;
  initial?: SshHost;
  onError: (error: unknown) => void;
  t: Translate;
}): void {
  const { context, initial, onError, t } = options;
  context.dialogs.open({
    content: (renderProps) => (
      <div className="contents" data-pier-ssh-scope="">
        <HostFormContent
          {...renderProps}
          context={context}
          initial={initial ?? null}
          onError={onError}
          t={t}
        />
      </div>
    ),
    id: FORM_DIALOG_ID,
    title: initial
      ? t("pier.ssh.form.editTitle", "Edit SSH host")
      : t("pier.ssh.form.addTitle", "Add SSH host"),
  });
}
